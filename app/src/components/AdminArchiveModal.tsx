import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { weeks, archives } from '../utils/supabase/db'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import Button from './Button'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function AdminArchiveModal({ visible, onClose }: Props) {
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
      const { error: archiveErr } = await archives.archiveWeek(activeWeek.id, forceArmed)
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
      setForceArmed(false)
      setWarning(null)
      onClose()
    } catch {
      showToast('Archive failed', 'error')
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    setForceArmed(false)
    setWarning(null)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Archive &amp; Advance Week?</Text>
          <Text style={styles.subtitle}>
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
          <View style={styles.btnRow}>
            <Button label="Cancel" variant="secondary" onPress={handleClose} fullWidth />
            <Button
              label={forceArmed ? 'Force Archive' : 'Archive & Advance'}
              variant={forceArmed ? 'danger' : 'primary'}
              onPress={confirm}
              loading={saving}
              disabled={saving}
              fullWidth
            />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
      {/* Rendered inside the Modal so toasts aren't occluded by the native modal layer. */}
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 20,
  },
  warnBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
    marginBottom: 18,
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
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
})
