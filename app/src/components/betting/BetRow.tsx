import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import TicketCard from './TicketCard'
import { betLineSuffix, type BetView } from '../../hooks/usePinsinoData'

interface BetRowProps {
  bet: BetView
  // Vestigial since the ticket restyle (cards carry their own margins) — kept
  // so callers don't churn.
  isLast: boolean
  badge: { label: string; color: string } | null
  betReturnText: string
  onPress?: () => void
  onCancelPress?: () => void
  // The viewer has a Ghost in the Slip on this bet — outline it in gold so they
  // can pick their haunts out of the active board (still secret to everyone else).
  haunted?: boolean
}

// One placed bet as a compact ticket card — the same shell the slip builds
// with, so what you placed looks like what you built. Presentational: the
// card is tappable when given an `onPress`, and shows a cancel (✕) affordance
// when given an `onCancelPress`. Callers gate those callbacks (read-only
// surfaces omit them; admin surfaces pass them).
export default function BetRow({
  bet,
  badge,
  betReturnText,
  onPress,
  onCancelPress,
  haunted,
}: BetRowProps) {
  const isParlay = bet.legCount > 1

  return (
    <TicketCard
      gold={bet.customLineCategory === 'special'}
      haunted={haunted}
      onPress={onPress}
    >
      <View style={styles.inner}>
        <View style={{ flex: 1 }}>
          {/* Custom-line branding: the special's title headlines its legs. */}
          {bet.customLineTitle != null && (
            <Text style={[styles.betTitle, bet.customLineCategory === 'special' && styles.betTitleSpecial]}>
              {bet.customLineTitle}
            </Text>
          )}
          {isParlay ? (
            <>
              {bet.legs.map((leg, i) => (
                <Text key={i} style={styles.betSubject}>
                  {leg.subjectName} · {leg.pick?.toUpperCase()}
                  {betLineSuffix(leg.marketType, leg.line, leg.statKey)}
                  {leg.gameNumber != null ? ` (G${leg.gameNumber})` : ''}
                  {leg.result ? ` — ${leg.result === 'crutched' ? 'SAVED 🩼' : leg.result.toUpperCase()}` : ''}
                </Text>
              ))}
              <Text style={styles.betDetails}>
                {bet.bettorName} · {bet.customLineTitle != null ? 'SPECIAL' : 'PARLAY'} ({bet.legCount} legs)
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.betSubject}>
                {bet.subjectName} · {bet.pick?.toUpperCase()}
                {betLineSuffix(bet.marketType, bet.line, bet.statKey)}
                {bet.gameNumber != null ? ` · G${bet.gameNumber}` : ''}
              </Text>
              <Text style={styles.betDetails}>
                {bet.bettorName}{bet.customLineTitle != null ? ' · SPECIAL' : ''}
              </Text>
            </>
          )}
        </View>
        <View style={styles.betRight}>
          {badge ? (
            <Text style={[styles.betBadge, { color: badge.color }]}>{badge.label}</Text>
          ) : (
            <Text style={styles.betPending}>PENDING</Text>
          )}
          <Text style={styles.betWager}>{betReturnText} pins</Text>
        </View>
        {!!onCancelPress && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancelPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </TicketCard>
  )
}

const styles = StyleSheet.create({
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  betSubject: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  betTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  betTitleSpecial: { color: colors.gold },
  betDetails: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  betRight: { alignItems: 'flex-end' },
  cancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.danger,
    lineHeight: 16,
  },
  betBadge: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  betPending: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
  },
  betWager: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
})
