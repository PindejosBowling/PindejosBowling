import { useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PinAmountInput from '../ui/PinAmountInput'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import { useUiStore } from '../../stores/uiStore'
import { AuctionView, isLargeBid } from '../../utils/auction'
import { auctions } from '../../utils/supabase/db'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Place or edit the viewer's sealed bid (free re-pricing — no increment,
  // any value >= minimum bid; FINDINGS §9). Mount conditionally.
  auction: AuctionView
  balance: number
  onClose: () => void
  onDone: () => void
}

export default function AuctionBidSheet({ auction: a, balance, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const editing = a.myBidAmount != null
  // Prefill: current bid when editing, minimum bid for a first pledge.
  const [amountText, setAmountText] = useState(String(editing ? a.myBidAmount : a.minimumBid))
  const [saving, setSaving] = useState(false)

  const amount = Number(amountText) || 0

  const error = useMemo<string | null>(() => {
    if (amount <= 0) return 'Enter your pledge'
    if (amount < a.minimumBid) return `Minimum bid is ${formatPins(a.minimumBid)}`
    if (amount > balance) return 'Bid exceeds your balance'
    return null
  }, [amount, a.minimumBid, balance])

  async function submit() {
    if (saving || error) return
    setSaving(true)
    try {
      const { error: rpcErr } = await auctions.placeBid(a.id, amount)
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast(editing ? 'Bid updated' : 'Bid pledged', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to submit bid', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={editing ? 'Edit Your Bid' : 'Place a Sealed Bid'}
      subtitle={`${a.itemIcon} ${a.itemName} · min ${formatPins(a.minimumBid)}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label={error ? 'Pledge' : `Pledge ${formatPins(amount)} pins`}
            size="lg"
            onPress={submit}
            loading={saving}
            disabled={!!error || saving}
            style={styles.submitBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <View style={styles.balanceRow}>
        <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
        <Text style={styles.balanceValue}>{formatPins(balance)} pins</Text>
      </View>

      <Text style={styles.label}>YOUR PLEDGE</Text>
      <PinAmountInput
        variant="big"
        value={amountText}
        onChangeText={setAmountText}
        placeholder={`min ${a.minimumBid}`}
      />
      {editing && (
        <Text style={styles.editHint}>
          Your current bid is {formatPins(a.myBidAmount ?? 0)}. Editing replaces it — and resets your
          tie-break clock.
        </Text>
      )}

      {/* §18.3 pledge terms — always shown. Dynamic lines (bounce fee, multi-unit)
          are composed here; the static rules live in the catalog. */}
      <TermsBlock
        terms={TERMS.auctionBid}
        extraLines={[
          `The bounce penalty on this auction is up to ${formatPins(a.bounceFee)} pins.`,
          ...(a.quantity > 1
            ? [`The top ${a.quantity} bids each win one — one per player, every winner pays their own pledge.`]
            : []),
        ]}
      />

      {!error && isLargeBid(amount, balance) && (
        <Text style={styles.largeBidWarning}>
          ⚠️ This bid is most of your current balance. Spend these pins before settlement and your check
          may bounce.
        </Text>
      )}

      {error && amount > 0 && <Text style={styles.errorText}>{error}</Text>}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  balanceRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 10, marginTop: 4,
  },
  balanceLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  balanceValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },

  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  editHint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },

  largeBidWarning: { fontFamily: fonts.barlow, fontSize: 13, color: colors.gold, marginTop: 10, lineHeight: 19 },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 10 },
  submitBtn: { marginTop: 14 },
})
