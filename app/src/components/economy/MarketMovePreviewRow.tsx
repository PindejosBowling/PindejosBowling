import { useMemo } from 'react'
import { Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts } from '../../theme'
import { timeAgo } from '../../utils/helpers'
import { renderFeedEvent, FeedEventView } from '../../utils/activityFeedTemplates'

interface Props {
  event: FeedEventView
  onPress?: () => void
  // The hub's fit-to-one-screen scale — fonts track the (scaled) feed box so
  // shrinking the box shrinks the text with it instead of clipping.
  fontScale?: number
}

// One page of the Pinsino hub's Market Moves mini-feed carousel. A ticker
// line, not a card: icon + rendered event line + relative timestamp. The
// full-fat treatment (avatar, amount badge, winner banner) lives in
// MarketMoveCard on the Market Moves screen.
export default function MarketMovePreviewRow({ event, onPress, fontScale = 1 }: Props) {
  const parts = useMemo(() => renderFeedEvent(event), [event])
  const f = (n: number) => Math.round(n * fontScale)

  // Deterministic length-based sizing instead of adjustsFontSizeToFit: iOS
  // shrinks multiline text by where the words happen to wrap, so two lines of
  // near-identical length can land at very different sizes. Thresholds are
  // tuned to the ~2-line capacity of the feed box at each size; numberOfLines
  // still ellipsizes the rare overflow.
  const len = parts.line.length
  const lineSize = len <= 52 ? 16 : len <= 80 ? 14 : 12

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} disabled={!onPress}>
      <Text style={[styles.icon, { fontSize: f(18) }]}>{parts.icon}</Text>
      <Text
        style={[styles.line, { fontSize: f(lineSize), lineHeight: f(Math.round(lineSize * 1.3)) }]}
        numberOfLines={2}
      >
        {parts.line}
      </Text>
      <Text style={[styles.time, { fontSize: f(13) }]}>{timeAgo(event.publishedAt)}</Text>
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
  icon: { fontSize: 18 },
  line: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 16,
    lineHeight: 20,
    color: colors.text,
  },
  time: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.muted,
  },
})
