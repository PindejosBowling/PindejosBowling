import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useUiStore } from '../../stores/uiStore'
import { weeks, archives } from '../../utils/supabase/db'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import type { FillScoreRow } from '../../hooks/useMatchupsData'

interface Props {
  // Mount conditionally so the force-arm state resets between opens.
  onClose: () => void
  // The unscored fill rows valued at the on-screen league-average estimate —
  // archive_week stamps these so archived records match the live totals.
  fillScores: FillScoreRow[]
}

// Built on BottomSheet directly (not ConfirmActionSheet): the no-pending-bets
// backstop turns the confirm into an armed two-step — the first failure surfaces
// the server warning and rearms the button as a forced retry — which doesn't fit
// the single-action contract.
export default function AdminArchiveModal({ onClose, fillScores }: Props) {
  const [saving, setSaving] = useState(false)
  // Armed after the server's settlement backstop rejects the archive because
  // bets would remain pending (unsettleable markets). Forcing voids + refunds them.
  const [forceArmed, setForceArmed] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
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

      // One atomic, audited transaction: snapshot → lock → settle (pins, bets,
      // loans, PvP, feed) → create next week (archive_week RPC, admin-gated).
      const { error: archiveErr } = await archives.archiveWeek(activeWeek.id, forceArmed, fillScores)
      if (archiveErr) {
        // The backstop raises (rolling the whole archive back) when settlement
        // would leave pending bets — surface it and arm a forced retry.
        if (!forceArmed && /remain pending/i.test(archiveErr.message)) {
          setWarning(archiveErr.message)
          setForceArmed(true)
          setSaving(false)
          return
        }
        showToast(`Failed to archive week ${activeWeek.week_number}: ${archiveErr.message}`, 'error')
        setSaving(false)
        return
      }

      showToast(`Week ${activeWeek.week_number} archived`, 'success')
      onClose()
    } catch {
      showToast('Archive failed', 'error')
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Archive & Advance Week?"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button
            label={forceArmed ? 'Force Archive' : 'Archive & Advance'}
            variant={forceArmed ? 'danger' : 'primary'}
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
        Locks this week's scores into the standings and creates a new week for team generation.
      </Text>
      {warning && (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{warning}</Text>
          <Text style={styles.warnSub}>
            Forcing voids those bets and refunds their stakes before archiving.
          </Text>
        </View>
      )}
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
  warnBox: {
    marginTop: 12,
    backgroundColor: colors.bg,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
  },
  warnText: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 17,
  },
  warnSub: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
  },
  confirmBtn: { marginTop: 18 },
})
