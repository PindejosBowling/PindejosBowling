import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL, formatStakes } from '../../utils/pvp'
import type { PvpChallengeView } from '../../hooks/usePvpData'

interface Props {
  challenge: PvpChallengeView
  viewerId: string | null
  onPress: () => void
  // Optional CTA chip text (e.g. "Your move", "Awaiting") shown under the row.
  cta?: string
}

// The opponent shown depends on which side the viewer is on. For a board row the
// viewer is neither party → show the creator.
function opponentLabel(c: PvpChallengeView, viewerId: string | null): string {
  if (viewerId && c.creatorId === viewerId) {
    return c.counterpartyName ? `vs ${c.counterpartyName}` : 'Open challenge'
  }
  if (viewerId && c.counterpartyId === viewerId) return `vs ${c.creatorName}`
  return `by ${c.creatorName}`
}

// Settled result from the viewer's perspective → label + color.
function resultChip(c: PvpChallengeView, viewerId: string | null): { text: string; color: string } {
  if (c.status === 'settled') {
    if (viewerId && c.winnerId === viewerId) return { text: 'WON', color: colors.success }
    if (viewerId && c.winnerId) return { text: 'LOST', color: colors.danger }
    return { text: 'SETTLED', color: colors.muted }
  }
  if (c.status === 'pushed') return { text: 'PUSH', color: colors.gold }
  if (c.status === 'pending' || c.status === 'countered') return { text: STATUS_LABEL[c.status].toUpperCase(), color: colors.gold }
  if (c.status === 'locked' || c.status === 'accepted') return { text: 'ACTIVE', color: colors.accent }
  return { text: (STATUS_LABEL[c.status] ?? c.status).toUpperCase(), color: colors.muted2 }
}

export default function PvpChallengeRow({ challenge: c, viewerId, onPress, cta }: Props) {
  const chip = resultChip(c, viewerId)
  const isCustom = c.contractType === 'custom'
  const scope = isCustom ? 'Custom' : c.gameNumber != null ? `Game ${c.gameNumber}` : 'Series'
  const typeLabel = (isCustom && c.customTitle) || CONTRACT_TYPE_LABEL[c.contractType] || c.contractType

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.topRow}>
        <Text style={styles.type} numberOfLines={1}>{typeLabel}</Text>
        <Text style={[styles.chip, { color: chip.color }]}>{chip.text}</Text>
      </View>
      <Text style={styles.opponent}>{opponentLabel(c, viewerId)}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{scope}</Text>
        <Text style={styles.metaDivider}>·</Text>
        <Text style={styles.meta}>Stake {formatStakes(c.creatorStake, c.counterpartyStake)}</Text>
        <Text style={styles.metaDivider}>·</Text>
        <Text style={styles.metaPot}>Pot {c.totalPot.toLocaleString()}</Text>
      </View>
      {cta ? <Text style={styles.cta}>{cta}</Text> : null}
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  type: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    fontWeight: '700',
  },
  chip: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  opponent: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  meta: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3 },
  metaPot: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.accent, letterSpacing: 0.3 },
  metaDivider: { color: colors.muted2 },
  cta: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
    marginTop: 8,
  },
})
