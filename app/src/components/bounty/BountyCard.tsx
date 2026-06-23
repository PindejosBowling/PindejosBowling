import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { formatCloseTime } from '../../utils/bounty'
import type { BountyView } from '../../hooks/useBountyBoardData'
import { formatPins } from '../../utils/formatting'

interface Props {
  bounty: BountyView
  viewerId?: string | null
  onPress: () => void
  // Admin list shows a "tap to manage" hint instead of the next-hunter terms.
  manageHint?: boolean
}

const STATUS_LABEL: Record<string, string> = {
  open: 'OPEN',
  closed: 'CLOSED',
  settled: 'SETTLED',
}

// One bounty row for the board / my-sections / admin list (design §29.1).
export default function BountyCard({ bounty: b, viewerId, onPress, manageHint }: Props) {
  const sponsorLabel = b.bountyType === 'house_bounty' ? 'The Pinsino' : (b.sponsorName ?? '—')
  const iSponsor = viewerId != null && b.sponsorPlayerId === viewerId
  const iEntered = viewerId != null && b.hunters.some(h => h.playerId === viewerId)

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>{b.title}</Text>
        <Text style={styles.status}>{STATUS_LABEL[b.status] ?? b.status.toUpperCase()}</Text>
      </View>
      <Text style={styles.sponsor}>
        by {sponsorLabel}
        {iSponsor ? ' · YOU SPONSOR' : ''}{iEntered ? ' · YOU ENTERED' : ''}
      </Text>

      <View style={styles.amountRow}>
        <View style={styles.amountCell}>
          <Text style={styles.amountValue}>{formatPins(b.hunterStakeAmount)}</Text>
          <Text style={styles.amountLabel}>STAKE</Text>
        </View>
        <View style={styles.amountCell}>
          <Text style={styles.amountValue}>+{formatPins(b.rewardPerHunter)}</Text>
          <Text style={styles.amountLabel}>REWARD EACH</Text>
        </View>
        <View style={styles.amountCell}>
          <Text style={styles.amountValue}>{b.hunterCount}/{b.maxHunters}</Text>
          <Text style={styles.amountLabel}>HUNTERS</Text>
        </View>
      </View>

      <Text style={styles.meta}>Closes {formatCloseTime(b.closesAt)}</Text>
      {manageHint ? (
        <Text style={styles.hint}>Tap to manage</Text>
      ) : b.status === 'open' ? (
        <Text style={[styles.nextTerms, b.slotsRemaining === 0 && styles.full]}>
          {b.slotsRemaining === 0
            ? 'Full — no slots left'
            : `Every hunter wins +${formatPins(b.rewardPerHunter)} · ${b.slotsRemaining} slot${b.slotsRemaining === 1 ? '' : 's'} left`}
        </Text>
      ) : null}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3, marginRight: 8 },
  status: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  sponsor: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 2 },

  amountRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  amountCell: { flex: 1, alignItems: 'center' },
  amountValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },
  amountLabel: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted, marginTop: 1 },

  meta: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 8 },
  nextTerms: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.success, letterSpacing: 0.3, marginTop: 4 },
  full: { color: colors.muted },
  hint: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.accent, letterSpacing: 0.3, marginTop: 4 },
})
