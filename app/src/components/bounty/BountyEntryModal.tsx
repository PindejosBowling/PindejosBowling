import { useState } from 'react'
import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { bountyPosts } from '../../utils/supabase/db'
import { hunterPayout } from '../../utils/bounty'
import type { BountyView } from '../../hooks/useBountyBoardData'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → enter RPC → toast +
  // onDone (reload) + onClose. The entry number / protected profit shown are an
  // estimate until the server assigns them under its per-bounty lock (design §16).
  bounty: BountyView
  onClose: () => void
  onDone: () => void
}

export default function BountyEntryModal({ bounty: b, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  const n = b.nextEntryNumber
  const stake = b.hunterStakeAmount
  const reward = b.rewardPerHunter
  const total = hunterPayout(stake, reward)

  async function confirm() {
    setSaving(true)
    try {
      const { error } = await bountyPosts.enter(b.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast('You joined the hunt', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to join', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Join the Hunt"
      subtitle={b.title}
      onClose={onClose}
      busy={saving}
      bodyMaxHeight={320}
      footer={
        <>
          <Button
            label={`Join & Stake ${stake.toLocaleString()}`}
            size="lg"
            onPress={confirm}
            loading={saving}
            disabled={saving}
            style={styles.confirmBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <Text style={styles.copy}>You are joining as <Text style={styles.bold}>Hunter #{n}</Text> ({b.hunterCount}/{b.maxHunters} in so far).</Text>
      <Text style={styles.copy}>You will stake <Text style={styles.bold}>{stake.toLocaleString()}</Text> pins.</Text>
      <Text style={styles.copy}>
        If the hunters win, you receive <Text style={styles.bold}>{total.toLocaleString()}</Text> pins total
        (your stake back + <Text style={styles.bold}>{reward.toLocaleString()}</Text> reward).
      </Text>
      <Text style={styles.copy}>Every hunter gets the same reward — more hunters never reduce your payout.</Text>
      <Text style={styles.copy}>If <Text style={styles.bold}>any</Text> hunter pulls it off, the whole pack wins. Bringing friends only helps.</Text>
      <Text style={styles.note}>
        An admin will manually settle this bounty based on the posted description. Your slot is an
        estimate until the server confirms it.
      </Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  copy: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 24 },
  bold: { fontFamily: fonts.barlowCondensed, color: colors.accent },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 18, marginTop: 12 },
  confirmBtn: { marginTop: 18 },
})
