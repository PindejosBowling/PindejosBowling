import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import ConfirmActionSheet from '../ui/ConfirmActionSheet'
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
      bodyMaxHeight={320}
      onClose={onClose}
      onDone={onDone}
    >
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Your stake</Text>
        <Text style={styles.rowValue}>{formatPins(myStake)} pins</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Opponent's stake</Text>
        <Text style={styles.rowValue}>{formatPins(oppStake)} pins</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Total pot</Text>
        <Text style={styles.rowValueAccent}>{formatPins(c.totalPot)} pins</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Winner's payout</Text>
        <Text style={styles.rowValueAccent}>{formatPins(c.payoutAmount)} pins</Text>
      </View>
      <Text style={styles.rule}>{CONTRACT_TYPE_RULE[c.contractType]}</Text>
      <Text style={styles.note}>
        Accepting escrows your stake immediately and locks the contract. It settles automatically
        when the week is archived. Winner takes the whole pot.
      </Text>
    </ConfirmActionSheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  rowLabel: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted },
  rowValue: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  rowValueAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },
  rule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 6 },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 17, marginTop: 10 },
})
