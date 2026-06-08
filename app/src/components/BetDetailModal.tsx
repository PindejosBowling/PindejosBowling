import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import type { BetView } from '../hooks/usePinsinoData'

// Badge from the bet's own status (the target model resolves outcome per bet).
export function resultBadge(status: string) {
  if (status === 'push') return { label: 'PUSH', color: colors.muted }
  if (status === 'won') return { label: 'WON', color: colors.success }
  if (status === 'lost') return { label: 'LOST', color: colors.danger }
  return null
}

// The bet's potential payout — the total returned on a win, incl. the stake.
// Snapshotted at placement (BetView.potentialPayout) and static for the bet's
// lifetime; this is the "to win" figure, independent of the outcome.
export function betPayout(bet: BetView): number {
  return bet.potentialPayout
}

// The realized return to the *player* — the actual pins that flow back once the
// bet settles:
//   won  → the full payout (stake back + winnings)
//   push → the stake, refunded
//   lost → 0 (nothing returns)
// While the bet is still pending nothing has flowed yet → null.
export function betReturn(bet: BetView): number | null {
  if (bet.status === 'won') return bet.potentialPayout
  if (bet.status === 'push' || bet.status === 'void') return bet.stake
  if (bet.status === 'lost') return 0
  return null // pending
}

// Signed string for `n`, '+' on positives, bare '-' on negatives, '0' for zero.
function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`
}

// The realized return as a player-facing string — `Pending` until the bet settles.
export function betReturnDisplay(bet: BetView): string {
  const r = betReturn(bet)
  return r == null ? 'Pending' : signed(r)
}

// The net pin flow of a bet for a row, signed for the given perspective — this is
// what each BetRow surfaces.
//   Player: +payout on a win (or the to-win preview while pending), −stake on a
//           loss, +stake refunded on a push.
//   House:  the exact mirror (it pays the payout, keeps the lost stake as pincome,
//           refunds the push), so 'house' negates the sign.
export function betReturnText(bet: BetView, perspective: 'player' | 'house' = 'player'): string {
  let amount: number
  if (bet.status === 'push' || bet.status === 'void') amount = bet.stake
  else if (bet.status === 'lost') amount = -bet.stake
  else amount = betPayout(bet) // won or still pending → full payout
  if (perspective === 'house') amount = -amount
  return signed(amount)
}

interface BetDetailModalProps {
  bet: BetView | null
  onClose: () => void
}

// Shared "Bet Details" overlay — the canonical breakdown of a single bet, opened
// from BetRow (Active/Settled Bets) and from LedgerRow (ledger activity).
export default function BetDetailModal({ bet, onClose }: BetDetailModalProps) {
  if (!bet) return null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Bet Details</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>BETTOR</Text>
            <Text style={styles.value}>{bet.bettorName}</Text>
          </View>

          {bet.seasonNumber != null && (
            <View style={styles.row}>
              <Text style={styles.label}>SEASON</Text>
              <Text style={styles.value}>{bet.seasonNumber}</Text>
            </View>
          )}

          {bet.weekNumber != null && (
            <View style={styles.row}>
              <Text style={styles.label}>WEEK</Text>
              <Text style={styles.value}>{bet.weekNumber}</Text>
            </View>
          )}

          {/* Legs, consolidated — a single bet is just one leg. Each line carries
              its own subject, pick, line, and game. Once settled, the leg's actual
              score follows a divider, color-coded to the leg's win/loss outcome. */}
          <View style={styles.row}>
            <Text style={styles.label}>{bet.legCount > 1 ? `LEGS (${bet.legCount})` : 'SELECTION'}</Text>
            {bet.legs.map((leg, i) => (
              <Text key={i} style={[styles.value, { marginTop: i === 0 ? 0 : 4 }]}>
                {leg.subjectName} · {leg.pick?.toUpperCase()}
                {leg.marketType === 'over_under' ? ` ${leg.line.toFixed(1)}` : ''}
                {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
                {leg.actualScore != null && (
                  <>
                    {' -- '}
                    <Text style={{ color: resultBadge(leg.result ?? '')?.color ?? colors.muted }}>
                      {leg.actualScore}
                    </Text>
                  </>
                )}
              </Text>
            ))}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>WAGER</Text>
            <Text style={styles.value}>{bet.stake} pins</Text>
          </View>

          {/* PAYOUT is the static "to win" figure; RETURN is the realized flow
              once settled (Pending until then). Both are player-perspective. */}
          <View style={styles.row}>
            <Text style={styles.label}>PAYOUT</Text>
            <Text style={styles.value}>{betPayout(bet)} pins</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>STATUS</Text>
            <Text style={[styles.value, { color: resultBadge(bet.status)?.color || colors.muted }]}>
              {resultBadge(bet.status)?.label || 'PENDING'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>RETURN</Text>
            {betReturn(bet) == null ? (
              <Text style={[styles.value, { color: colors.muted }]}>PENDING</Text>
            ) : (
              <Text style={styles.value}>{betReturnDisplay(bet)} pins</Text>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  content: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  close: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted,
  },
  row: {
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
  },
})
