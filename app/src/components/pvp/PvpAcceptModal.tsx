import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import ConfirmActionSheet from '../ui/ConfirmActionSheet'
import StatRow from '../ui/StatRow'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import { pvpChallenges } from '../../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPE_RULE } from '../../utils/pvp'
import type { PvpChallengeView } from '../../hooks/usePvpData'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → accept RPC → toast +
  // onDone (reload) + onClose. Accepting = accepting the full revised contract.
  challenge: PvpChallengeView
  viewerId: string | null
  onClose: () => void
  onDone: () => void
}

export default function PvpAcceptModal({ challenge: c, viewerId, onClose, onDone }: Props) {
  // The viewer accepts the *other* side's offer. Stakes may be asymmetric, so show
  // both: the viewer's own side and the opponent's.
  const iAmCreator = viewerId != null && viewerId === c.creatorId
  const myStake = iAmCreator ? c.creatorStake : c.counterpartyStake
  const oppStake = iAmCreator ? c.counterpartyStake : c.creatorStake

  return (
    <ConfirmActionSheet
      title={`Accept ${CONTRACT_TYPE_LABEL[c.contractType]}`}
      subtitle={`vs ${c.creatorName} · ${c.gameNumber != null ? `Game ${c.gameNumber}` : 'Series'}`}
      confirmLabel={`Accept & Stake ${formatPins(myStake)}`}
      action={() => pvpChallenges.accept(c.id)}
      successMessage="Challenge accepted"
      failureMessage="Failed to accept"
      onClose={onClose}
      onDone={onDone}
    >
      <StatRow label="Your stake" value={`${formatPins(myStake)} pins`} />
      <StatRow label="Opponent's stake" value={`${formatPins(oppStake)} pins`} />
      <StatRow label="Total pot" value={`${formatPins(c.totalPot)} pins`} variant="accent" />
      <StatRow label="Winner's payout" value={`${formatPins(c.payoutAmount)} pins`} variant="accent" />
      <Text style={styles.rule}>{CONTRACT_TYPE_RULE[c.contractType]}</Text>
      <TermsBlock terms={TERMS.pvpAccept} />
    </ConfirmActionSheet>
  )
}

const styles = StyleSheet.create({
  rule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 6 },
})
