import { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import { colors, fonts } from '../theme'
import Toast from './Toast'
import Button from './Button'
import { useUiStore } from '../stores/uiStore'
import { customLines } from '../utils/supabase/db'

interface Props {
  // Mounted conditionally so it resets between opens. `line` is a raw
  // custom_lines row (the admin list works on raw rows, not resolved views).
  // None of these actions move pins: bets already placed hold concrete
  // selections and settle normally whatever happens to the line.
  line: any
  onClose: () => void
  onDone: () => void
  onEdit: () => void
}

export default function CustomLineAdminActionModal({ line, onClose, onDone, onEdit }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  async function run(label: string, fn: () => PromiseLike<{ error: any }>) {
    setSaving(true)
    try {
      const { error } = await fn()
      if (error) { showToast(error.message, 'error'); return }
      showToast(label, 'success')
      onDone()
      onClose()
    } catch {
      showToast('Action failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  function remove() {
    Alert.alert(
      'Delete this special?',
      'It comes off the board immediately. Bets already placed keep their selections and settle normally — only the board offering disappears. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run('Special deleted', () => customLines.remove(line.id)) },
      ],
    )
  }

  const legCount = Array.isArray(line.legs) ? line.legs.length : 0

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={[styles.title, line.category === 'special' && { color: colors.gold }]}>{line.title}</Text>
          <Text style={styles.subtitle}>
            {line.week_ids == null ? 'EVERY WEEK' : `${line.week_ids.length} WEEK${line.week_ids.length === 1 ? '' : 'S'}`}
            {' · '}{legCount} LEG{legCount === 1 ? '' : 'S'}
            {' · '}{line.is_active ? 'ACTIVE' : 'DISABLED'}
          </Text>

          <Button variant="outline" label="Edit" disabled={saving} onPress={onEdit} style={styles.actSpacing} />
          <Button
            variant="outline"
            label={line.is_active ? 'Disable (hide from board)' : 'Enable'}
            disabled={saving}
            onPress={() => run(
              line.is_active ? 'Special disabled' : 'Special enabled',
              () => customLines.update(line.id, { is_active: !line.is_active }),
            )}
            style={styles.actSpacing}
          />
          <Button variant="outline" tone="danger" label="Delete" disabled={saving} onPress={remove} style={styles.actSpacing} />

          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </View>
      </KeyboardAvoidingView>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: colors.border, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  title: { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5, marginTop: 2, marginBottom: 16 },
  actSpacing: { marginBottom: 8 },
})
