import { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, spacing, ticketStyles, type } from '../../theme'

interface TicketCardProps {
  // Optional header row: title (accent; gold when titleGold) + a right-aligned
  // badge (e.g. the ×2ⁿ multiplier, a result chip).
  header?: {
    title: string
    titleGold?: boolean
    badge?: { label: string; color: string }
  }
  // Gold trim (specials) — gold border + wash on the whole card.
  gold?: boolean
  // Ghost-in-the-Slip reveal: gold outline without the wash.
  haunted?: boolean
  // Whole-card tap (open details). Omit for a static ticket.
  onPress?: () => void
  // Stake fields / item toggles / return text — separated from the legs by a
  // dashed "perforation".
  footer?: ReactNode
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

// The ticket shell — one card = one bet. Shared by the slip's build tickets
// (parlay/single/special) and the placed-bet rows (BetRow), so what you build
// looks like what you placed. Presentational; callers gate the tap.
export default function TicketCard({ header, gold, haunted, onPress, footer, children, style }: TicketCardProps) {
  const Shell: any = onPress ? TouchableOpacity : View
  return (
    <Shell
      style={[
        ticketStyles.card,
        styles.card,
        gold && ticketStyles.cardGold,
        haunted && styles.cardHaunted,
        style,
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : undefined}
    >
      <View style={[ticketStyles.rail, gold && styles.railGold, styles.rail]} />
      {header != null && (
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, header.titleGold && styles.headerTitleGold]} numberOfLines={1}>
            {header.title}
          </Text>
          {header.badge != null && (
            <Text style={[styles.headerBadge, { color: header.badge.color }]}>{header.badge.label}</Text>
          )}
        </View>
      )}
      {children}
      {footer != null && (
        <>
          <View style={ticketStyles.divider} />
          {footer}
        </>
      )}
    </Shell>
  )
}

const styles = StyleSheet.create({
  // The rail hugs the card's top edge — pull it over the card padding.
  card: { paddingTop: spacing.lg, overflow: 'hidden' },
  rail: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  railGold: { backgroundColor: colors.goldDim },
  cardHaunted: { borderColor: colors.gold },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerTitle: { ...type.chipLg, color: colors.accent, flexShrink: 1 },
  headerTitleGold: { color: colors.gold },
  headerBadge: { ...type.value },
})
