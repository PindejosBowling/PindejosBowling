import React, { useState, useEffect, useCallback, useMemo } from 'react'
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
import AppHeader from '../components/league/AppHeader'
import ConfirmBar from '../components/ui/ConfirmBar'
import LoadingView from '../components/ui/LoadingView'
import { usePendingStore } from '../stores/pendingStore'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import {
  players as dbPlayers,
  rsvp as dbRsvp,
  weeks as dbWeeks,
  betMarkets as dbBetMarkets,
  seasons as dbSeasons,
  rsvpBonusConfig as dbRsvpBonusConfig,
  pinLedger as dbPinLedger,
} from '../utils/supabase/db'
import type { Tables } from '../utils/supabase/database.types'
import { initials } from '../utils/helpers'
import { colors, fonts, radius } from '../theme'

type Player = Tables<'players'>
type RsvpRow = Tables<'rsvp'>
type RsvpBonusConfig = Tables<'rsvp_bonus_config'>

export default function RsvpScreen() {
  const [playerList, setPlayerList] = useState<Player[]>([])
  const [rsvpRows, setRsvpRows] = useState<RsvpRow[]>([])
  const [weekId, setWeekId] = useState<string | null>(null)
  const [bowledAt, setBowledAt] = useState<string | null>(null)
  const [bonusConfig, setBonusConfig] = useState<RsvpBonusConfig | null>(null)
  const [bonusClaimed, setBonusClaimed] = useState(false)
  const [loading, setLoading] = useState(true)
  const { pendingRSVP, set } = usePendingStore()
  const [saving, setSaving] = useState(false)
  const { role, playerId: myPlayerId } = useAuthStore()
  const { showToast } = useUiStore()
  const isAdmin = role === 'admin'

  function canEdit(playerId: string) {
    return isAdmin || playerId === myPlayerId
  }

  const load = useCallback(async () => {
    const seasonRes = await dbSeasons.getCurrent()
    const [weekRes, playersRes, cfgRes] = await Promise.all([
      dbWeeks.getCurrent(),
      // Only show players registered for the current season.
      seasonRes.data ? dbPlayers.listBySeason(seasonRes.data.id) : dbPlayers.list(),
      dbRsvpBonusConfig.getGlobal(),
    ])
    if (playersRes.data) setPlayerList(playersRes.data)
    if (cfgRes.data) setBonusConfig(cfgRes.data)
    if (weekRes.data) {
      const wid = weekRes.data.id
      setWeekId(wid)
      setBowledAt(weekRes.data.bowled_at)
      const rsvpRes = await dbRsvp.listByWeek(wid)
      if (rsvpRes.data) setRsvpRows(rsvpRes.data)
      // Whether I've already earned this week's RSVP bonus — hides the banner.
      if (myPlayerId) {
        const claimRes = await dbPinLedger.rsvpBonusForWeek(wid, myPlayerId)
        setBonusClaimed(!!claimRes.data)
      }
    } else {
      console.warn('RsvpScreen: no current week found', weekRes.error?.message)
    }
    setLoading(false)
  }, [myPlayerId])

  useEffect(() => { load() }, [load])

  const { refreshing, onRefresh } = useRefresh(load)

  // Keep bet lines in sync with who is "in" for the week. Runs after any RSVP
  // mutation. Creates lines (current-season avg → floor+0.5) for in-players who
  // are missing them, and refunds+removes lines for players no longer in.
  // Reads fresh state from Supabase rather than trusting component state.
  async function syncBetLines(wid: string) {
    // O/U market create/refund runs entirely server-side (the
    // sync_over_under_markets_for_week RPC), derived from rsvp + scores. This keeps
    // a non-admin self-RSVP'ing out from needing direct bet_markets/bets/pin_ledger
    // write access — the tables are admin-only at the RLS layer; the SECURITY
    // DEFINER RPC does the privileged work (incl. refunding others' bets). Idempotent.
    const { error } = await dbBetMarkets.syncOUForWeek(wid)
    await dbBetMarkets.syncLanetalkPropsForWeek(wid)
    if (error) {
      Alert.alert('Bet line sync failed', error.message ?? 'Could not update bet lines for the RSVP change.')
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

  // Pin the current user's own row to the top so they can respond immediately;
  // everyone else keeps the alphabetical order from the DB query.
  const orderedPlayers = useMemo(() => {
    if (!myPlayerId) return playerList
    const mine = playerList.filter(p => p.id === myPlayerId)
    if (mine.length === 0) return playerList
    return [...mine, ...playerList.filter(p => p.id !== myPlayerId)]
  }, [playerList, myPlayerId])

  // Header label for the upcoming bowl night: "Day Of Week, Month Day @ Time".
  // bowled_at is a date-only column (a Monday); the DB has no time-of-day field,
  // so the time is the fixed league-night convention (7pm ET). Parse at noon to
  // dodge the UTC-midnight → prior-day shift in negative-offset timezones.
  const gameHeader = useMemo(() => {
    if (!bowledAt) return null
    const d = new Date(`${bowledAt}T12:00:00`)
    if (isNaN(d.getTime())) return null
    const dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    return `${dateLabel} @ 7:00 PM`
  }, [bowledAt])

  // Deadline banner (display only — submit_own_rsvp is authoritative). The exact
  // cutoff is (bowled_at + deadline_time) in the configured timezone; here we
  // parse it as a wall-clock Date for the "by <day> <time>" label and to hide the
  // banner once the moment has passed. Shown while enabled, unclaimed, and open.
  const bonusBanner = useMemo(() => {
    if (!bonusConfig?.is_enabled || bonusClaimed || !bowledAt) return null
    // deadline_time is 'HH:MM:SS'; treat bowled_at + time as local wall-clock.
    const deadline = new Date(`${bowledAt}T${bonusConfig.deadline_time}`)
    if (isNaN(deadline.getTime()) || Date.now() > deadline.getTime()) return null
    // Fully-defined "DAY_OF_WEEK, MONTH DAY" (e.g. "Monday, July 20").
    const dateLabel = deadline.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    const time = deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return { amount: bonusConfig.bonus_amount, dateLabel, time }
  }, [bonusConfig, bonusClaimed, bowledAt])

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
      // Split the batch: my OWN row goes through submit_own_rsvp (which pays the
      // house bonus for a personal submission), everyone else's stays a plain
      // upsert (admin/proxy — never earns a bonus).
      const entries = Object.entries(pendingRSVP)
      const mine = entries.find(([player_id]) => player_id === myPlayerId)
      const others = entries.filter(([player_id]) => player_id !== myPlayerId)

      if (others.length > 0) {
        const upsertData = others.map(([player_id, status]) => ({
          week_id: weekId,
          player_id,
          status,
        }))
        const { error } = await dbRsvp.upsert(upsertData)
        if (error) {
          Alert.alert('Save failed', error.message)
          return
        }
      }

      if (mine) {
        const { data, error } = await dbRsvp.submitOwn(weekId, mine[1])
        if (error) {
          Alert.alert('Save failed', error.message)
          return
        }
        const result = data as { awarded: boolean; amount: number; reason: string } | null
        if (result?.awarded) {
          setBonusClaimed(true)
          showToast(`🎳 +${result.amount} pins from the House for RSVPing!`, 'success')
        } else if (result?.reason === 'already_claimed') {
          setBonusClaimed(true)
        }
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
      // Clears the week's RSVPs AND revokes any 50-pin bonuses they earned.
      const { error } = await dbRsvp.resetForWeek(weekId)
      if (error) { showToast(error.message, 'error'); return }
      setRsvpRows([])
      set({ pendingRSVP: {} })
      setBonusClaimed(false)
      await syncBetLines(weekId)
    }
    const msg = 'This clears all RSVPs for the week and takes back any RSVP bonuses they earned.'
    if (Platform.OS === 'web') {
      if (window.confirm(`Reset RSVPs? ${msg}`)) doReset()
    } else {
      Alert.alert('Reset RSVPs?', msg, [
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
          data={orderedPlayers}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, hasPending && { paddingBottom: 80 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <>
              {gameHeader && (
                <View style={styles.gameHeader}>
                  <Text style={styles.gameHeaderLabel}>NEXT UP</Text>
                  <Text style={styles.gameHeaderDate}>{gameHeader}</Text>
                </View>
              )}
              {bonusBanner && (
                <View style={styles.bonusBanner}>
                  <Text style={styles.bonusBannerEmoji}>🎳</Text>
                  <Text style={styles.bonusBannerText}>
                    RSVP yourself by <Text style={styles.bonusBannerDate}>{bonusBanner.dateLabel}</Text> at{' '}
                    {bonusBanner.time} to earn{' '}
                    <Text style={styles.bonusBannerAmount}>+{bonusBanner.amount} pins</Text> from the House.
                  </Text>
                </View>
              )}
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
  gameHeader: {
    marginTop: 12,
    alignItems: 'center',
  },
  gameHeaderLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
    textAlign: 'center',
  },
  gameHeaderDate: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    textAlign: 'center',
  },
  bonusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.cardSm,
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  bonusBannerEmoji: {
    fontSize: 20,
  },
  bonusBannerText: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  bonusBannerDate: {
    fontFamily: fonts.barlowSemiBold,
    color: colors.text,
  },
  bonusBannerAmount: {
    fontFamily: fonts.barlowCondensed,
    color: colors.success,
  },
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
