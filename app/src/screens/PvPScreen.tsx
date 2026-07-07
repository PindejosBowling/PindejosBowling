import { useCallback, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import PvPShootoutBackdrop from '../components/pixelart/PvPShootoutBackdrop'
import PvpChallengeRow from '../components/pvp/PvpChallengeRow'
import PvpChallengeDetailModal from '../components/pvp/PvpChallengeDetailModal'
import Button from '../components/ui/Button'
import BalancePill from '../components/ui/BalancePill'
import { usePvpData, PvpChallengeView } from '../hooks/usePvpData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useEconomyRefresh } from '../hooks/useEconomyRefresh'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function PvPScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, balance, inbox, openBoard, record, reload } = usePvpData(playerId, pinsinoViewSeasonId)

  // Reload the inbox AND the Pinsino notification badges together — the pending-action
  // count is derived from the same "received" contracts shown here.
  const reloadAll = useEconomyRefresh(reload)

  const [detailId, setDetailId] = useState<string | null>(null)

  // Refresh on return (e.g. after creating a challenge). The hook's own mount load
  // covers the first paint; subsequent focus reloads are silent (no full-screen loader).
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

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
    <ScreenContainer
      title="PvP"
      subtitle="Challenge a rival, winner takes the pot"
      backdrop={<PvPShootoutBackdrop />}
      loading={loading}
      onRefresh={reloadAll}
    >
        {readOnly && <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />}

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

        <BalancePill balance={balance} style={styles.balanceMargin} />

        {/* Entry points — hidden in past-season review (no new challenges). */}
        {!readOnly && (
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
        )}

        {/* Inbox — in past-season review only settled challenges exist. */}
        {nothing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {readOnly ? 'No challenges this season.' : 'No challenges yet. Start one or browse the board.'}
            </Text>
          </View>
        ) : (
          <>
            {section('RECEIVED', inbox.received, () => 'Your move →')}
            {section('SENT', inbox.sent, () => 'Awaiting opponent')}
            {section('ACTIVE', inbox.active, () => 'Locked · settles on archive')}
            {section('HISTORY', inbox.settled)}
          </>
        )}

      {detailId && (
        <PvpChallengeDetailModal
          challengeId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reloadAll}
        />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
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

  balanceMargin: { marginTop: 0, marginBottom: 16 },

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
