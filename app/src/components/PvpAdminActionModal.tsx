import { useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { pvpChallenges } from '../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL } from '../utils/pvp'
import type { PvpChallengeView } from '../hooks/usePvpData'

interface Props {
  // Mount conditionally so it resets between opens. Each action → RPC → toast +
  // onDone (reload) + onClose. Maps the design's settle/cancel/void to the live RPCs.
  challenge: PvpChallengeView
  onClose: () => void
  onDone: () => void
}

export default function PvpAdminActionModal({ challenge: c, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const isLive = c.status === 'pending' || c.status === 'countered'
  const isLocked = c.status === 'locked' || c.status === 'accepted'

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

  function confirm(title: string, onYes: () => void) {
    Alert.alert(title, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: onYes },
    ])
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {(c.contractType === 'custom' && c.customTitle) || CONTRACT_TYPE_LABEL[c.contractType] || 'Challenge'}
          </Text>
          <Text style={styles.subtitle}>
            {c.creatorName} vs {c.counterpartyName ?? 'Open'} · {(STATUS_LABEL[c.status] ?? c.status).toUpperCase()} · Pot {c.totalPot.toLocaleString()}
          </Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {c.contractType === 'custom' && c.customDescription ? (
              <>
                <Text style={styles.label}>WIN CONDITION</Text>
                <View style={styles.conditionCard}>
                  <Text style={styles.conditionText}>{c.customDescription}</Text>
                </View>
              </>
            ) : null}

            <Text style={styles.label}>ADMIN NOTE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Reason / adjudication notes…"
              placeholderTextColor={colors.muted2}
              multiline
              maxLength={240}
            />

            {isLocked && (
              <>
                <Text style={styles.section}>MANUAL SETTLE</Text>
                <TouchableOpacity
                  style={styles.actBtn}
                  disabled={saving}
                  onPress={() => confirm(`${c.creatorName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.creatorId, note)))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actText}>{c.creatorName} wins</Text>
                </TouchableOpacity>
                {c.counterpartyId && (
                  <TouchableOpacity
                    style={styles.actBtn}
                    disabled={saving}
                    onPress={() => confirm(`${c.counterpartyName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.counterpartyId, note)))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actText}>{c.counterpartyName} wins</Text>
                  </TouchableOpacity>
                )}
                {c.contractType !== 'custom' && (
                  <TouchableOpacity
                    style={styles.actBtn}
                    disabled={saving}
                    onPress={() => confirm('Auto-settle from scores?', () => run('Settled from scores', () => pvpChallenges.settle(c.id, null, note)))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actText}>Auto-settle from scores (push if tied)</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <Text style={styles.section}>RESOLVE / REVERSE</Text>
            {(isLocked || c.status === 'settled') && (
              <TouchableOpacity
                style={[styles.actBtn, styles.dangerBtn]}
                disabled={saving}
                onPress={() => confirm('Void & refund both?', () => run('Voided — stakes refunded', () => pvpChallenges.void(c.id, note)))}
                activeOpacity={0.7}
              >
                <Text style={styles.dangerText}>Void (refund both stakes)</Text>
              </TouchableOpacity>
            )}
            {(isLive || isLocked || c.status === 'settled') && (
              <TouchableOpacity
                style={[styles.actBtn, styles.dangerBtn]}
                disabled={saving}
                onPress={() => confirm('Cancel this contract?', () => run('Cancelled', () => pvpChallenges.cancel(c.id)))}
                activeOpacity={0.7}
              >
                <Text style={styles.dangerText}>Cancel contract</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <TouchableOpacity onPress={() => !saving && onClose()} activeOpacity={0.7}>
            <Text style={styles.close}>Close</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  title: { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3, marginTop: 2, marginBottom: 8 },
  body: { maxHeight: 420 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 12, marginBottom: 8 },
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  conditionCard: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  conditionText: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 21 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  actBtn: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  actText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, letterSpacing: 0.5 },
  dangerBtn: { borderColor: colors.danger },
  dangerText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.danger, letterSpacing: 0.5 },
  close: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 14 },
})
