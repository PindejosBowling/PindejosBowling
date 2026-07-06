import { useCallback, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import PvpChallengeRow from '../components/pvp/PvpChallengeRow'
import PvpAcceptModal from '../components/pvp/PvpAcceptModal'
import PvpCounterModal from '../components/pvp/PvpCounterModal'
import PvpChallengeDetailModal from '../components/pvp/PvpChallengeDetailModal'
import Button from '../components/ui/Button'
import { usePvpData, PvpChallengeView } from '../hooks/usePvpData'
import { useAuthStore } from '../stores/authStore'
import { CONTRACT_TYPE_LABEL } from '../utils/pvp'
import { formatPins } from '../utils/formatting'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

// The contract-type filters share the pill row with a "Challenges Won" results
// view; 'won' is a distinct mode (not a contract type), so selecting it swaps
// the open board for the leaguewide settled-results feed.
const WON = 'won'
const FILTERS = ['All', 'line_duel', 'head_to_head', WON]

function filterLabel(item: string): string {
  if (item === 'All') return 'All'
  if (item === WON) return 'Challenges Won'
  return CONTRACT_TYPE_LABEL[item] ?? item
}

// A settled challenge's outcome, named so it reads regardless of who's viewing:
// "🏆 Winner def. Loser · won N".
function wonCta(c: PvpChallengeView): string {
  const winnerName = c.winnerId === c.creatorId ? c.creatorName : c.counterpartyName
  const loserName = c.winnerId === c.creatorId ? c.counterpartyName : c.creatorName
  return `🏆 ${winnerName ?? '—'} def. ${loserName ?? '—'} · won ${formatPins(c.payoutAmount)}`
}

export default function PvPBoardScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  const { loading, balance, openBoard, wonBoard, inbox, reload } = usePvpData(playerId)

  const [filter, setFilter] = useState('All')
  const showingWon = filter === WON
  const [acceptTarget, setAcceptTarget] = useState<PvpChallengeView | null>(null)
  const [counterTarget, setCounterTarget] = useState<PvpChallengeView | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  // Refresh on return (e.g. after posting an open challenge). Silent after first load.
  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const rows = useMemo(
    () => (filter === 'All' ? openBoard : openBoard.filter(c => c.contractType === filter)),
    [openBoard, filter],
  )

  // The viewer's own open-board posts (counterparty still null, still pending).
  // They're filtered out of `openBoard` because you can't accept your own, but the
  // board should still show them so you can confirm the post went live.
  const myOpen = useMemo(() => {
    const mine = inbox.sent.filter(c => c.counterpartyId == null && c.status === 'pending')
    return filter === 'All' ? mine : mine.filter(c => c.contractType === filter)
  }, [inbox.sent, filter])

  if (loading) return <LoadingView label="Loading…" delayed />

  return (
    <ScreenContainer
      title="Challenge Board"
      subtitle={showingWon ? 'Settled results — this season' : 'Open contracts — first to accept locks it'}
      pinned={
        <PillFilter
          items={FILTERS}
          value={filter}
          onChange={setFilter}
          renderLabel={filterLabel}
        />
      }
      onRefresh={reload}
    >
        {showingWon ? (
          // Challenges Won: every settled contract leaguewide this season, a
          // public results feed. Read-only (no accept/counter); tap for detail.
          wonBoard.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No challenges have been settled yet this season.</Text>
            </View>
          ) : (
            wonBoard.map(c => (
              <PvpChallengeRow
                key={c.id}
                challenge={c}
                viewerId={playerId}
                onPress={() => setDetailId(c.id)}
                cta={wonCta(c)}
              />
            ))
          )
        ) : (
        <>
        <Button
          label="+ Post Open Challenge"
          onPress={() => navigation.navigate('PvPCreate', { openBoard: true })}
          style={styles.postBtn}
        />

        {myOpen.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>YOUR OPEN POSTS ({myOpen.length})</Text>
            {myOpen.map(c => (
              <PvpChallengeRow
                key={c.id}
                challenge={c}
                viewerId={playerId}
                onPress={() => setDetailId(c.id)}
                cta="Waiting for a taker · tap to manage"
              />
            ))}
            <Text style={styles.sectionLabel}>OPEN CHALLENGES</Text>
          </>
        )}

        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No open challenges right now.</Text>
          </View>
        ) : (
          rows.map(c => (
            <View key={c.id}>
              <PvpChallengeRow
                challenge={c}
                viewerId={playerId}
                onPress={() => setDetailId(c.id)}
              />
              <View style={styles.actionRow}>
                <Button
                  label="Accept"
                  onPress={() => setAcceptTarget(c)}
                  disabled={balance < c.creatorStake}
                  fullWidth
                  style={styles.actBtn}
                />
                <Button variant="outline" label="Counter" onPress={() => setCounterTarget(c)} fullWidth style={[styles.actBtn, styles.counterBtn]} />
              </View>
            </View>
          ))
        )}
        </>
        )}

      {acceptTarget && (
        <PvpAcceptModal
          challenge={acceptTarget}
          viewerId={playerId}
          onClose={() => setAcceptTarget(null)}
          onDone={reload}
        />
      )}
      {counterTarget && (
        <PvpCounterModal
          challenge={counterTarget}
          viewerId={playerId}
          balance={balance}
          onClose={() => setCounterTarget(null)}
          onDone={reload}
        />
      )}
      {detailId && (
        <PvpChallengeDetailModal
          challengeId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  postBtn: { marginTop: 4, marginBottom: 16 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: -2, marginBottom: 16 },
  actBtn: { paddingVertical: 11 },
  counterBtn: { backgroundColor: colors.surface },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center' },
})
