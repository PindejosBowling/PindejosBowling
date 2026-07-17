import { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

// One centered value-over-label cell in the card's stat row.
export interface StatCell {
  value: string
  label: string
  // Render the value at text size instead of headline size — for cells whose
  // value is a phrase (e.g. an absolute close date) rather than a number.
  small?: boolean
  // Width weight within the row (default 1) — widen a cell whose value wraps.
  flex?: number
}

interface Props {
  // Header row: title (truncated) + right-aligned status badge. Both optional —
  // MarketMoveCard-style rows render entirely through children.
  title?: string
  badge?: { text: string; color?: string }
  subtitle?: string
  // Line clamp for the subtitle (default 1; 0 = no clamp, wrap fully). Loosen
  // when the subtitle carries meaning that must survive wrapping (e.g. an
  // item's effect line).
  subtitleLines?: number
  stats?: StatCell[]
  // Render stat labels as column headers above the values (default: value
  // over label, the original economy-card order).
  statLabelsAbove?: boolean
  // Dim the whole card (e.g. a scheduled auction).
  dim?: boolean
  // Omit for a non-tappable card.
  onPress?: () => void
  // Feature-specific footer content (meta lines, CTAs, result text) — the card
  // owns the shared skeleton, features pass data and their own footer rows.
  children?: ReactNode
}

// The economy list-card primitive: the surface/border/padding shell + the
// header / subtitle / stat-row skeleton previously re-declared by BountyCard,
// AuctionCard, PvpChallengeRow, and MarketMoveCard.
export default function EconomyCard({ title, badge, subtitle, subtitleLines = 1, stats, statLabelsAbove, dim, onPress, children }: Props) {
  const body = (
    <>
      {(title != null || badge != null) && (
        <View style={styles.headerRow}>
          {title != null && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          {badge != null && (
            <Text style={[styles.badge, badge.color != null && { color: badge.color }]}>{badge.text}</Text>
          )}
        </View>
      )}
      {subtitle != null && (
        <Text style={styles.subtitle} numberOfLines={subtitleLines === 0 ? undefined : subtitleLines}>
          {subtitle}
        </Text>
      )}
      {stats != null && stats.length > 0 && (
        <View style={styles.statRow}>
          {stats.map((s, i) => {
            const value = <Text key="v" style={[styles.statValue, s.small && styles.statValueSmall]}>{s.value}</Text>
            const label = <Text key="l" style={[styles.statLabel, statLabelsAbove && styles.statLabelAbove]}>{s.label}</Text>
            return (
              <View key={i} style={[styles.statCell, s.flex != null && { flex: s.flex }, statLabelsAbove && styles.statCellHeadered]}>
                {statLabelsAbove ? [label, value] : [value, label]}
              </View>
            )
          })}
        </View>
      )}
      {children}
    </>
  )

  if (!onPress) return <View style={[styles.card, dim && styles.cardDim]}>{body}</View>
  return (
    <TouchableOpacity style={[styles.card, dim && styles.cardDim]} onPress={onPress} activeOpacity={0.7}>
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
  cardDim: { opacity: 0.7 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3, marginRight: 8 },
  badge: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  subtitle: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 2 },

  statRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  statValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },
  // Phrase-valued cells: smaller, wrappable, baseline-aligned with the row.
  statValueSmall: { fontFamily: fonts.barlowCondensed, fontSize: 14, lineHeight: 17, textAlign: 'center' },
  statLabel: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted, marginTop: 1 },
  // Header order: label sits on the shared top line, value hangs below.
  statCellHeadered: { justifyContent: 'flex-start' },
  statLabelAbove: { marginTop: 0, marginBottom: 2 },
})
