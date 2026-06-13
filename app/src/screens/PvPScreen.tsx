import { useCallback, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import ArtworkToggle from '../components/ui/ArtworkToggle'
import PvPShootoutBackdrop from '../components/pixelart/PvPShootoutBackdrop'
import LoadingView from '../components/ui/LoadingView'
import PvpChallengeRow from '../components/pvp/PvpChallengeRow'
import PvpChallengeDetailModal from '../components/pvp/PvpChallengeDetailModal'
import Button from '../components/ui/Button'
import { usePvpData, PvpChallengeView } from '../hooks/usePvpData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useNotificationStore } from '../stores/notificationStore'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function PvPScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const artworkReveal = useUiStore(s => s.artworkReveal)

  const { loading, balance, inbox, openBoard, record, reload } = usePvpData(playerId)

  // Reload the inbox AND the Pinsino notification badges together. The pending-action
  // count (tile + tab-bar badge) is derived from the same "received" contracts shown
  // here, so any mutation that changes this list must re-fetch the badge counts too —
  // otherwise the badge stays stale until PinsinoScreen re-focuses.
  const reloadAll = useCallback(
    () => Promise.all([reload(), useNotificationStore.getState().refresh()]).then(() => {}),
    [reload],
  )

  const { refreshing, onRefresh } = useRefresh(reloadAll)
  const [detailId, setDetailId] = useState<string | null>(null)

  // Refresh on return (e.g. after creating a challenge). The hook's own mount load
  // covers the first paint; subsequent focus reloads are silent (no full-screen loader).
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

  // Transitions stay art-only: the backdrop paints immediately and the
  // spinner appears only if loading drags past 5s.
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <PvPShootoutBackdrop />
        <LoadingView label="Loading…" transparent delayed />
      </SafeAreaView>
    )
  }

  function openDetail(c: PvpChallengeView) {
    setDetailId(c.id)
  }

  const section = (
    title: string,
    rows: PvpChallengeView[],
    cta?: (c: PvpChallengeView) => string | undefined,
  ) =>
    rows.length > 0 ? (
      <>
        <Text style={styles.sectionLabel}>{title} ({rows.length})</Text>
        {rows.map(c => (
          <PvpChallengeRow
            key={c.id}
            challenge={c}
            viewerId={playerId}
            onPress={() => openDetail(c)}
            cta={cta?.(c)}
          />
        ))}
      </>
    ) : null

  const nothing =
    inbox.received.length === 0 &&
    inbox.sent.length === 0 &&
    inbox.active.length === 0 &&
    inbox.settled.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PvPShootoutBackdrop />
      <ScreenHeader title="PvP" subtitle="Challenge a rival, winner takes the pot" onBack={() => navigation.goBack()} right={<ArtworkToggle />} />
      {!artworkReveal && (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Record + balance summary */}
        <View style={styles.recordCard}>
          <View style={styles.recordCell}>
            <Text style={styles.recordValue}>{record.wins}</Text>
            <Text style={styles.recordLabel}>WINS</Text>
          </View>
          <View style={styles.recordDivider} />
          <View style={styles.recordCell}>
            <Text style={styles.recordValue}>{record.losses}</Text>
            <Text style={styles.recordLabel}>LOSSES</Text>
          </View>
          <View style={styles.recordDivider} />
          <View style={styles.recordCell}>
            <Text style={styles.recordValue}>{record.pushes}</Text>
            <Text style={styles.recordLabel}>PUSHES</Text>
          </View>
        </View>

        <View style={styles.balancePill}>
          <Text style={styles.balancePillLabel}>BALANCE</Text>
          <Text style={styles.balancePillValue}>{balance.toLocaleString()} pins</Text>
        </View>

        {/* Entry points */}
        <View style={styles.actions}>
          <Button label="New Challenge" onPress={() => navigation.navigate('PvPCreate')} fullWidth style={styles.primaryBtn} />
          <Button
            variant="outline"
            label={`Challenge Board${openBoard.length > 0 ? ` (${openBoard.length})` : ''}`}
            onPress={() => navigation.navigate('PvPBoard')}
            fullWidth
            style={styles.secondaryBtn}
          />
        </View>

        {/* Inbox */}
        {nothing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No challenges yet. Start one or browse the board.</Text>
          </View>
        ) : (
          <>
            {section('RECEIVED', inbox.received, () => 'Your move →')}
            {section('SENT', inbox.sent, () => 'Awaiting opponent')}
            {section('ACTIVE', inbox.active, () => 'Locked · settles on archive')}
            {section('HISTORY', inbox.settled)}
          </>
        )}
      </ScrollView>
      )}

      {detailId && (
        <PvpChallengeDetailModal
          challengeId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reloadAll}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 18,
    marginTop: 8,
    marginBottom: 12,
  },
  recordCell: { flex: 1, alignItems: 'center' },
  recordDivider: { width: 1, height: 32, backgroundColor: colors.border },
  recordValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 32, color: colors.accent },
  recordLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted, marginTop: 2 },

  balancePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  balancePillLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted },
  balancePillValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },

  actions: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  primaryBtn: { paddingVertical: 14 },
  secondaryBtn: { paddingVertical: 14, backgroundColor: colors.surface },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
})
