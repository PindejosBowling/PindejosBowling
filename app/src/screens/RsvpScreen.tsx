import React, { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AppHeader from '../components/AppHeader'
import ConfirmBar from '../components/ConfirmBar'
import LoadingView from '../components/LoadingView'
import { useDataStore } from '../stores/dataStore'
import { usePendingStore } from '../stores/pendingStore'
import { apiPost } from '../api.js'
import { initials } from '../utils/helpers.js'
import { colors, fonts, radius } from '../theme'

export default function RsvpScreen() {
  const { loading, roster, rsvp, loadAll } = useDataStore()
  const { pendingRSVP, set } = usePendingStore()
  const [saving, setSaving] = useState(false)

  const players = (roster ?? []).slice(1).filter((r: any[]) => r[0]) as any[][]

  function currentStatus(name: string): string {
    const row = (rsvp ?? []).slice(1).find((r: any[]) => r[0] === name)
    return row ? row[1] : ''
  }

  function effectiveStatus(name: string): string {
    return pendingRSVP[name] ?? currentStatus(name)
  }

  function isPending(name: string): boolean {
    return pendingRSVP[name] !== undefined
  }

  const inCount = players.filter(r => effectiveStatus(r[0]) === 'In').length
  const outCount = players.filter(r => effectiveStatus(r[0]) === 'Out').length
  const noReply = players.filter(r => !effectiveStatus(r[0])).length
  const pendingCount = Object.keys(pendingRSVP).length
  const hasPending = pendingCount > 0

  function stageRSVP(name: string, status: string) {
    const alreadyStaged = pendingRSVP[name] === status
    const alreadyCurrent = pendingRSVP[name] === undefined && currentStatus(name) === status
    if (alreadyStaged || alreadyCurrent) {
      const next = { ...pendingRSVP }
      delete next[name]
      set({ pendingRSVP: next })
    } else {
      set({ pendingRSVP: { ...pendingRSVP, [name]: status } })
    }
  }

  function discard() {
    set({ pendingRSVP: {} })
  }

  async function saveChanges() {
    setSaving(true)
    try {
      const changes = Object.entries(pendingRSVP).map(([name, status]) => ({ name, status }))
      await apiPost('batchUpdateRSVP', { changes })
      const currentRsvp = useDataStore.getState().rsvp as any[][]
      const updatedRsvp = currentRsvp.map((row: any[], i: number) => {
        if (i === 0) return row
        const pending = pendingRSVP[row[0]]
        return pending !== undefined ? [row[0], pending] : row
      })
      useDataStore.setState({ rsvp: updatedRsvp })
      set({ pendingRSVP: {} })
    } finally {
      setSaving(false)
    }
  }

  function resetRSVP() {
    Alert.alert('Reset RSVPs?', 'This will clear all RSVPs for the upcoming week.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await apiPost('resetRSVP')
          await loadAll()
          set({ pendingRSVP: {} })
        },
      },
    ])
  }

  if (loading || !roster) {
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
          data={players}
          keyExtractor={(item) => item[0]}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, hasPending && { paddingBottom: 80 }]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}
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
                <TouchableOpacity onPress={resetRSVP} style={styles.resetBtn} activeOpacity={0.7}>
                  <Text style={styles.resetBtnText}>Reset</Text>
                </TouchableOpacity>
              </View>
            </>
          }
          renderItem={({ item }) => {
            const name = item[0]
            const status = effectiveStatus(name)
            const pending = isPending(name)
            return (
              <View style={[styles.playerRow, pending && styles.playerRowPending]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{name}</Text>
                </View>
                <View style={styles.rsvpButtons}>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, status === 'In' && styles.rsvpBtnInActive]}
                    onPress={() => stageRSVP(name, 'In')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'In' && styles.rsvpBtnTextActive]}>In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, status === 'Out' && styles.rsvpBtnOutActive]}
                    onPress={() => stageRSVP(name, 'Out')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rsvpBtnText, status === 'Out' && styles.rsvpBtnTextActive]}>Out</Text>
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
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
})
