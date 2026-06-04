import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { weeks } from '../utils/supabase/db'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function AdminArchiveModal({ visible, onClose }: Props) {
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

      const today = new Date().toISOString().slice(0, 10)
      const { error: archiveErr } = await weeks.update(activeWeek.id, { is_archived: true, bowled_at: today })
      if (archiveErr) {
        showToast('Failed to archive week', 'error')
        setSaving(false)
        return
      }

      const { error: insertErr } = await weeks.insert({
        season_id: activeWeek.season_id,
        week_number: activeWeek.week_number + 1,
      })
      if (insertErr) {
        showToast(`Week ${activeWeek.week_number} archived — failed to create next week`, 'error')
      } else {
        showToast(`Week ${activeWeek.week_number} archived`, 'success')
      }

      onClose()
    } catch {
      showToast('Archive failed', 'error')
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
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
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={handleClose}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={confirm}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>Archive &amp; Advance</Text>
              )}
            </TouchableOpacity>
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
    backgroundColor: 'rgba(0,0,0,0.7)',
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
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  btnCancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.4,
  },
})
