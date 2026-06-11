import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import type { BetView } from '../../hooks/usePinsinoData'
import { resultBadge, betPayout, betReturn, betReturnDisplay } from '../../utils/bets'

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

          {/* Custom-line branding (snapshotted onto the bet at placement). */}
          {bet.customLineTitle != null && (
            <View style={styles.row}>
              <Text style={styles.label}>SPECIAL</Text>
              <Text style={[styles.value, bet.customLineCategory === 'special' && { color: colors.gold }]}>
                {bet.customLineTitle}
              </Text>
              {!!bet.customLineDescription && (
                <Text style={styles.customDescription}>{bet.customLineDescription}</Text>
              )}
            </View>
          )}

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
    backgroundColor: colors.overlay,
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
  customDescription: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
})
