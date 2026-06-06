import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import type { BetView } from '../hooks/useBettingData'

// Badge from the bet's own status (the target model resolves outcome per bet).
export function resultBadge(status: string) {
  if (status === 'push') return { label: 'PUSH', color: colors.muted }
  if (status === 'won') return { label: 'WON', color: colors.success }
  if (status === 'lost') return { label: 'LOST', color: colors.danger }
  return null
}

// Signed return on a bet, from the chosen perspective.
// potential_payout = total returned on a win incl. the stake. A push refunds the
// stake; a loss forfeits it; a pending bet shows its projected full return.
// The house's return is the exact opposite of the player's (the house pays the
// payout, keeps the lost stake, refunds the push), so 'house' negates the sign.
export function betReturnText(bet: BetView, perspective: 'player' | 'house' = 'player'): string {
  let amount: number
  if (bet.status === 'push' || bet.status === 'void') amount = bet.stake
  else if (bet.status === 'lost') amount = -bet.stake
  else amount = bet.potentialPayout // won or still pending → full return
  if (perspective === 'house') amount = -amount
  return `${amount >= 0 ? '+' : ''}${amount}`
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
                {leg.subjectName} · {leg.pick?.toUpperCase()} {leg.line.toFixed(1)}
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

          <View style={styles.row}>
            <Text style={styles.label}>STATUS</Text>
            <Text style={[styles.value, { color: resultBadge(bet.status)?.color || colors.muted }]}>
              {resultBadge(bet.status)?.label || 'PENDING'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>RETURN</Text>
            <Text style={styles.value}>{betReturnText(bet)} pins</Text>
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
