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
import {
  players as dbPlayers,
  rsvp as dbRsvp,
  weeks as dbWeeks,
  betLines as dbBetLines,
  pinLedger as dbPinLedger,
} from '../utils/supabase/db'
import type { Tables } from '../utils/supabase/database.types'
import { initials } from '../utils/helpers'
import { computeAvgById, lineForAvg } from '../utils/betLines'
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
  const { role, playerId: myPlayerId } = useAuthStore()
  const isAdmin = role === 'admin'

  function canEdit(playerId: string) {
    return isAdmin || playerId === myPlayerId
  }

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

  // Keep bet lines in sync with who is "in" for the week. Runs after any RSVP
  // mutation. Creates lines (current-season avg → floor+0.5) for in-players who
  // are missing them, and refunds+removes lines for players no longer in.
  // Reads fresh state from Supabase rather than trusting component state.
  async function syncBetLines(wid: string) {
    try {
      const [rsvpRes, linesRes] = await Promise.all([
        dbRsvp.listByWeek(wid),
        dbBetLines.listByWeek(wid),
      ])
      const rows = rsvpRes.data ?? []
      const lines = linesRes.data ?? []
      const inIds = new Set(rows.filter(r => r.status === 'in').map(r => r.player_id))

      // Group existing lines by player; the established game set for the week is
      // the distinct game_numbers already present (defaults to games 1 & 2 when
      // none exist yet, so late In-joiners match the set incl. game 3 post-gen).
      const gamesByPlayer = new Map<string, Set<number>>()
      const targetGames = new Set<number>()
      for (const l of lines) {
        if (!gamesByPlayer.has(l.player_id)) gamesByPlayer.set(l.player_id, new Set())
        gamesByPlayer.get(l.player_id)!.add(l.game_number)
        targetGames.add(l.game_number)
      }
      if (targetGames.size === 0) { targetGames.add(1); targetGames.add(2) }

      // Refund + remove: players with lines who are no longer "in".
      const toCancel = [...gamesByPlayer.keys()].filter(pid => !inIds.has(pid))
      if (toCancel.length > 0) {
        const { error } = await dbPinLedger.cancelBetLinesForPlayers(wid, toCancel)
        if (error) throw error
      }

      // Create: in-players missing any target game line.
      const missing = [...inIds]
        .map(pid => {
          const have = gamesByPlayer.get(pid) ?? new Set<number>()
          return { pid, need: [...targetGames].filter(g => !have.has(g)) }
        })
        .filter(m => m.need.length > 0)
      if (missing.length > 0) {
        const { avgById, leagueAvg } = await computeAvgById('current')
        const insertRows = missing.flatMap(m =>
          m.need.map(g => ({
            week_id: wid,
            player_id: m.pid,
            game_number: g,
            line: lineForAvg(avgById[m.pid] ?? leagueAvg),
          })),
        )
        const { error } = await dbBetLines.insert(insertRows)
        if (error) throw error
      }
    } catch (e: any) {
      Alert.alert('Bet line sync failed', e?.message ?? 'Could not update bet lines for the RSVP change.')
    }
  }

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
      const rsvpRes = await dbRsvp.listByWeek(weekId)
      if (rsvpRes.data) setRsvpRows(rsvpRes.data)
      set({ pendingRSVP: {} })
      await syncBetLines(weekId)
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
      await syncBetLines(weekId)
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
                    style={[styles.rsvpBtn, status === 'in' && styles.rsvpBtnInActive, !canEdit(item.id) && styles.rsvpBtnReadOnly]}
                    onPress={canEdit(item.id) ? () => stageRSVP(item.id, 'in') : undefined}
                    activeOpacity={canEdit(item.id) ? 0.7 : 1}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'in' && styles.rsvpBtnTextActive]}>In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, status === 'out' && styles.rsvpBtnOutActive, !canEdit(item.id) && styles.rsvpBtnReadOnly]}
                    onPress={canEdit(item.id) ? () => stageRSVP(item.id, 'out') : undefined}
                    activeOpacity={canEdit(item.id) ? 0.7 : 1}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'out' && styles.rsvpBtnTextActive]}>Out</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
        {hasPending && (
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
