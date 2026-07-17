import { useMemo } from 'react'
import { Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts } from '../../theme'
import { timeAgo } from '../../utils/helpers'
import { renderFeedEvent, FeedEventView } from '../../utils/activityFeedTemplates'

interface Props {
  event: FeedEventView
  onPress?: () => void
}

// One page of the Pinsino hub's Market Moves mini-feed carousel. A ticker
// line, not a card: icon + rendered event line + relative timestamp. The
// full-fat treatment (avatar, amount badge, winner banner) lives in
// MarketMoveCard on the Market Moves screen.
export default function MarketMovePreviewRow({ event, onPress }: Props) {
  const parts = useMemo(() => renderFeedEvent(event), [event])

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} disabled={!onPress}>
      <Text style={styles.icon}>{parts.icon}</Text>
      <Text style={styles.line} numberOfLines={2}>{parts.line}</Text>
      <Text style={styles.time}>{timeAgo(event.publishedAt)}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
  },
  icon: { fontSize: 16 },
  line: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
  },
  time: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.muted,
  },
})
