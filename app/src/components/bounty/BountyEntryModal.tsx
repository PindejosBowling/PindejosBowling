import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import ConfirmActionSheet from '../ui/ConfirmActionSheet'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import { bountyPosts } from '../../utils/supabase/db'
import { hunterPayout } from '../../utils/bounty'
import type { BountyView } from '../../hooks/useBountyBoardData'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → enter RPC → toast +
  // onDone (reload) + onClose. The entry number / protected profit shown are an
  // estimate until the server assigns them under its per-bounty lock (design §16).
  bounty: BountyView
  onClose: () => void
  onDone: () => void
}

export default function BountyEntryModal({ bounty: b, onClose, onDone }: Props) {
  const n = b.nextEntryNumber
  const stake = b.hunterStakeAmount
  const reward = b.rewardPerHunter
  const total = hunterPayout(stake, reward)

  return (
    <ConfirmActionSheet
      title="Join the Hunt"
      subtitle={b.title}
      confirmLabel={`Join & Stake ${formatPins(stake)}`}
      action={() => bountyPosts.enter(b.id)}
      successMessage="You joined the hunt"
      failureMessage="Failed to join"
      bodyMaxHeight={320}
      onClose={onClose}
      onDone={onDone}
    >
      <Text style={styles.copy}>You are joining as <Text style={styles.bold}>Hunter #{n}</Text> ({b.hunterCount}/{b.maxHunters} in so far).</Text>
      <Text style={styles.copy}>You will stake <Text style={styles.bold}>{formatPins(stake)}</Text> pins.</Text>
      <Text style={styles.copy}>
        If the hunters win, you receive <Text style={styles.bold}>{formatPins(total)}</Text> pins total
        (your stake back + <Text style={styles.bold}>{formatPins(reward)}</Text> reward).
      </Text>
      <TermsBlock terms={TERMS.bountyEnter} />
      <Text style={styles.note}>Your slot is an estimate until the server confirms it.</Text>
    </ConfirmActionSheet>
  )
}

const styles = StyleSheet.create({
  copy: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 24 },
  bold: { fontFamily: fonts.barlowCondensed, color: colors.accent },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 18, marginTop: 12 },
})
