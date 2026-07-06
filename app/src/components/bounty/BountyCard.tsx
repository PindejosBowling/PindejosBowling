import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import EconomyCard from '../ui/EconomyCard'
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
    <EconomyCard
      title={b.title}
      badge={{ text: STATUS_LABEL[b.status] ?? b.status.toUpperCase() }}
      subtitle={`by ${sponsorLabel}${iSponsor ? ' · YOU SPONSOR' : ''}${iEntered ? ' · YOU ENTERED' : ''}`}
      stats={[
        { value: formatPins(b.hunterStakeAmount), label: 'STAKE' },
        { value: `+${formatPins(b.rewardPerHunter)}`, label: 'REWARD EACH' },
        { value: `${b.hunterCount}/${b.maxHunters}`, label: 'HUNTERS' },
      ]}
      onPress={onPress}
    >
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
    </EconomyCard>
  )
}

const styles = StyleSheet.create({
  meta: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 8 },
  nextTerms: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.success, letterSpacing: 0.3, marginTop: 4 },
  full: { color: colors.muted },
  hint: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.accent, letterSpacing: 0.3, marginTop: 4 },
})
