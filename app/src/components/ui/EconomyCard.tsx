import { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

// One centered value-over-label cell in the card's stat row.
export interface StatCell {
  value: string
  label: string
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
export default function EconomyCard({ title, badge, subtitle, subtitleLines = 1, stats, dim, onPress, children }: Props) {
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
          {stats.map((s, i) => (
            <View key={i} style={styles.statCell}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
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
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },
  statLabel: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted, marginTop: 1 },
})
