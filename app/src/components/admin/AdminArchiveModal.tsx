import { useState } from 'react'
import { Text, StyleSheet } from 'react-native'
import { useUiStore } from '../../stores/uiStore'
import { weeks, archives } from '../../utils/supabase/db'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import type { FillScoreRow } from '../../hooks/useMatchupsData'

interface Props {
  onClose: () => void
  // The unscored fill rows valued at the on-screen league-average estimate —
  // advance_week stamps these so archived records match the live totals.
  fillScores: FillScoreRow[]
}

// "Advance Week" — the bowl-night clock. Locks the week's scores into the
// standings and opens the next week. Deliberately moves NO money: bets, pincome,
// loans, PvP and the House P/L settle the next day via the Settle step (the
// "Settle Week" flow on the LaneTalk import screen, once the frame data lands).
export default function AdminArchiveModal({ onClose, fillScores }: Props) {
  const [saving, setSaving] = useState(false)
  const { showToast } = useUiStore()

  async function confirm() {
    setSaving(true)
    try {
      const { data: activeWeek, error: weekErr } = await weeks.getActive()
      if (weekErr || !activeWeek) {
        showToast('No active week found', 'error')
        setSaving(false)
        return
      }

      // Bowl-night: snapshot fills → lock → create next week. No settlement.
      const { error: advanceErr } = await archives.advanceWeek(activeWeek.id, false, fillScores)
      if (advanceErr) {
        showToast(`Failed to advance week ${activeWeek.week_number}: ${advanceErr.message}`, 'error')
        setSaving(false)
        return
      }

      showToast(`Week ${activeWeek.week_number} advanced — settle it after the imports land`, 'success')
      onClose()
    } catch {
      showToast('Advance failed', 'error')
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Advance Week?"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button
            label="Advance Week"
            variant="primary"
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
      <Text style={styles.body}>
        Locks this week's scores into the standings and opens the next week for team
        generation. Money settles later — once the frame data is imported, run Settle
        Week from the LaneTalk screen.
      </Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  body: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 4,
  },
  confirmBtn: { marginTop: 18 },
})
