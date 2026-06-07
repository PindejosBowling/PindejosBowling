import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import PlayerAvatar from './PlayerAvatar'
import { timeAgo } from '../utils/helpers'
import { renderFeedEvent, FeedEventView } from '../utils/activityFeedTemplates'

interface Props {
  event: FeedEventView
  onPress?: () => void // omit (or undefined) for a non-tappable card
}

// One row in the Market Moves feed (design §16.1). Mirrors the surface/border
// card styling used across the Pinsino screens. The feature icon + actor avatar
// lead; the rendered line follows; a meta row carries the relative timestamp +
// source label and the optional amount badge.
export default function MarketMoveCard({ event, onPress }: Props) {
  const parts = useMemo(() => renderFeedEvent(event), [event])
  const hasActor = event.actorPlayerId != null && event.actorName != null

  const winner = parts.winner

  const body = (
    <View style={styles.card}>
      {winner && (
        <View style={styles.winnerBanner}>
          <Text style={styles.winnerTrophy}>🏆</Text>
          <Text style={styles.winnerLabel}>WINNER</Text>
          <Text style={styles.winnerName} numberOfLines={1}>{winner.name}</Text>
        </View>
      )}
      <View style={styles.leadRow}>
        {hasActor ? (
          <PlayerAvatar name={event.actorName} playerId={event.actorPlayerId} size={36} />
        ) : (
          <View style={styles.iconCircle}>
            <Text style={styles.iconCircleText}>{parts.icon}</Text>
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.line}>
            {hasActor ? `${parts.icon} ` : ''}
            {parts.line}
          </Text>
          <Text style={styles.meta}>
            {timeAgo(event.publishedAt)} · {parts.sourceLabel}
          </Text>
        </View>
        {parts.amount && (
          <View style={styles.amountBadge}>
            {parts.amount.label && <Text style={styles.amountLabel}>{parts.amount.label}</Text>}
            <Text
              style={[
                styles.amountText,
                parts.amount.tone === 'positive' ? styles.amountPositive : styles.amountNeutral,
              ]}
            >
              +{parts.amount.value.toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    </View>
  )

  if (!onPress) return body
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {body}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  // Victory treatment — a gold trophy banner above an otherwise-standard card.
  winnerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(251,191,36,0.25)',
  },
  winnerTrophy: { fontSize: 14 },
  winnerLabel: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.gold,
  },
  winnerName: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    letterSpacing: 0.3,
    color: colors.gold,
  },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleText: { fontSize: 18 },
  body: { flex: 1 },
  line: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    lineHeight: 19,
  },
  meta: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 4,
  },
  amountBadge: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  amountLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.muted,
    marginBottom: 1,
  },
  amountText: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 15 },
  amountPositive: { color: colors.success },
  amountNeutral: { color: colors.accent },
})
