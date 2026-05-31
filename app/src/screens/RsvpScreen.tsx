import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Platform,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import AppHeader from '../components/AppHeader'
import ConfirmBar from '../components/ConfirmBar'
import LoadingView from '../components/LoadingView'
import { usePendingStore } from '../stores/pendingStore'
import { useAuthStore } from '../stores/authStore'
import { players as dbPlayers, rsvp as dbRsvp, weeks as dbWeeks } from '../utils/supabase/db'
import type { Tables } from '../utils/supabase/database.types'
import { initials } from '../utils/helpers.js'
import { colors, fonts, radius } from '../theme'

type Player = Tables<'players'>
type RsvpRow = Tables<'rsvp'>

export default function RsvpScreen() {
  const [playerList, setPlayerList] = useState<Player[]>([])
  const [rsvpRows, setRsvpRows] = useState<RsvpRow[]>([])
  const [weekId, setWeekId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { pendingRSVP, set } = usePendingStore()
  const [saving, setSaving] = useState(false)
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const load = useCallback(async () => {
    const [weekRes, playersRes] = await Promise.all([
      dbWeeks.getCurrent(),
      dbPlayers.listActive(),
    ])
    if (playersRes.data) setPlayerList(playersRes.data)
    if (weekRes.data) {
      const wid = weekRes.data.id
      setWeekId(wid)
      const rsvpRes = await dbRsvp.listByWeek(wid)
      if (rsvpRes.data) setRsvpRows(rsvpRes.data)
    } else {
      console.warn('RsvpScreen: no current week found', weekRes.error?.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const { refreshing, onRefresh } = useRefresh(load)

  function currentStatus(playerId: string): string {
    return rsvpRows.find(r => r.player_id === playerId)?.status ?? ''
  }

  function effectiveStatus(playerId: string): string {
    return pendingRSVP[playerId] ?? currentStatus(playerId)
  }

  function isPending(playerId: string): boolean {
    return pendingRSVP[playerId] !== undefined
  }

  const inCount = playerList.filter(p => currentStatus(p.id) === 'in').length
  const outCount = playerList.filter(p => currentStatus(p.id) === 'out').length
  const noReply = playerList.filter(p => !currentStatus(p.id)).length
  const pendingCount = Object.keys(pendingRSVP).length
  const hasPending = pendingCount > 0

  function stageRSVP(playerId: string, status: string) {
    const alreadyStaged = pendingRSVP[playerId] === status
    const alreadyCurrent = pendingRSVP[playerId] === undefined && currentStatus(playerId) === status
    if (alreadyStaged || alreadyCurrent) {
      const next = { ...pendingRSVP }
      delete next[playerId]
      set({ pendingRSVP: next })
    } else {
      set({ pendingRSVP: { ...pendingRSVP, [playerId]: status } })
    }
  }

  function discard() {
    set({ pendingRSVP: {} })
  }

  async function saveChanges() {
    if (!weekId) {
      Alert.alert('Error', 'No active week found. Cannot save RSVPs.')
      return
    }
    setSaving(true)
    try {
      const upsertData = Object.entries(pendingRSVP).map(([player_id, status]) => ({
        week_id: weekId,
        player_id,
        status,
      }))
      const { error } = await dbRsvp.upsert(upsertData)
      if (error) {
        Alert.alert('Save failed', error.message)
        return
      }
      setRsvpRows(prev => {
        const next = [...prev]
        for (const { player_id, status } of upsertData) {
          const idx = next.findIndex(r => r.player_id === player_id)
          if (idx >= 0) {
            next[idx] = { ...next[idx], status }
          } else {
            next.push({ id: '', week_id: weekId, player_id, status, note: null, updated_at: new Date().toISOString() })
          }
        }
        return next
      })
      set({ pendingRSVP: {} })
    } finally {
      setSaving(false)
    }
  }

  function resetRSVP() {
    const doReset = async () => {
      if (!weekId) return
      await dbRsvp.removeByWeek(weekId)
      setRsvpRows([])
      set({ pendingRSVP: {} })
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Reset RSVPs? This will clear all RSVPs for the upcoming week.')) doReset()
    } else {
      Alert.alert('Reset RSVPs?', 'This will clear all RSVPs for the upcoming week.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: doReset },
      ])
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader />
        <LoadingView label="Loading RSVP" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <FlatList
          data={playerList}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, hasPending && { paddingBottom: 80 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <>
              <View style={styles.summaryRow}>
                <View style={[styles.statCard, styles.statIn]}>
                  <Text style={styles.statLabel}>In</Text>
                  <Text style={styles.statVal}>{inCount}</Text>
                </View>
                <View style={[styles.statCard, styles.statOut]}>
                  <Text style={styles.statLabel}>Out</Text>
                  <Text style={styles.statVal}>{outCount}</Text>
                </View>
                <View style={[styles.statCard, styles.statUnknown]}>
                  <Text style={styles.statLabel}>No Reply</Text>
                  <Text style={styles.statVal}>{noReply}</Text>
                </View>
              </View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>THIS WEEK</Text>
                {isAdmin && (
                  <TouchableOpacity onPress={resetRSVP} style={styles.resetBtn} activeOpacity={0.7}>
                    <Text style={styles.resetBtnText}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          }
          renderItem={({ item }) => {
            const status = effectiveStatus(item.id)
            const pending = isPending(item.id)
            return (
              <View style={[styles.playerRow, pending && styles.playerRowPending]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(item.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{item.name}</Text>
                </View>
                <View style={styles.rsvpButtons}>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, status === 'in' && styles.rsvpBtnInActive, !isAdmin && styles.rsvpBtnReadOnly]}
                    onPress={isAdmin ? () => stageRSVP(item.id, 'in') : undefined}
                    activeOpacity={isAdmin ? 0.7 : 1}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'in' && styles.rsvpBtnTextActive]}>In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, status === 'out' && styles.rsvpBtnOutActive, !isAdmin && styles.rsvpBtnReadOnly]}
                    onPress={isAdmin ? () => stageRSVP(item.id, 'out') : undefined}
                    activeOpacity={isAdmin ? 0.7 : 1}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'out' && styles.rsvpBtnTextActive]}>Out</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
        {isAdmin && hasPending && (
          <ConfirmBar
            icon="✏️"
            title={saving ? `Saving ${pendingCount} change${pendingCount !== 1 ? 's' : ''}...` : `${pendingCount} unsaved change${pendingCount !== 1 ? 's' : ''}`}
            subtext={saving ? undefined : 'Save or discard your changes'}
            saving={saving}
            onDiscard={discard}
            onSave={saveChanges}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIn: { borderColor: 'rgba(74,222,128,0.3)' },
  statOut: { borderColor: 'rgba(255,79,109,0.3)' },
  statUnknown: {},
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 4,
  },
  statVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 28,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(255,79,109,0.4)',
  },
  resetBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.danger,
    letterSpacing: 0.5,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  playerRowPending: {
    backgroundColor: colors.surface2,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.5,
  },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  rsvpButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  rsvpBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  rsvpBtnInActive: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderColor: colors.success,
  },
  rsvpBtnOutActive: {
    backgroundColor: 'rgba(255,79,109,0.15)',
    borderColor: colors.danger,
  },
  rsvpBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  rsvpBtnTextActive: {
    color: colors.text,
  },
  rsvpBtnReadOnly: {
    opacity: 0.4,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
})
