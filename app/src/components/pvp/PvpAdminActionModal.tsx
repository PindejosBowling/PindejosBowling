import { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { pvpChallenges } from '../../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL } from '../../utils/pvp'
import type { PvpChallengeView } from '../../hooks/usePvpData'

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
    <BottomSheet
      title={(c.contractType === 'custom' && c.customTitle) || CONTRACT_TYPE_LABEL[c.contractType] || 'Challenge'}
      subtitle={`${c.creatorName} vs ${c.counterpartyName ?? 'Open'} · ${(STATUS_LABEL[c.status] ?? c.status).toUpperCase()} · Pot ${c.totalPot.toLocaleString()}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      bodyMaxHeight={420}
      footer={
        <>
          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </>
      }
    >
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
          <Button
            variant="outline"
            label={`${c.creatorName} wins`}
            disabled={saving}
            onPress={() => confirm(`${c.creatorName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.creatorId, note)))}
            style={styles.actSpacing}
          />
          {c.counterpartyId && (
            <Button
              variant="outline"
              label={`${c.counterpartyName} wins`}
              disabled={saving}
              onPress={() => confirm(`${c.counterpartyName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.counterpartyId, note)))}
              style={styles.actSpacing}
            />
          )}
          {c.contractType !== 'custom' && (
            <Button
              variant="outline"
              label="Auto-settle from scores (push if tied)"
              disabled={saving}
              onPress={() => confirm('Auto-settle from scores?', () => run('Settled from scores', () => pvpChallenges.settle(c.id, null, note)))}
              style={styles.actSpacing}
            />
          )}
        </>
      )}

      <Text style={styles.section}>RESOLVE / REVERSE</Text>
      {(isLocked || c.status === 'settled') && (
        <Button
          variant="outline"
          tone="danger"
          label="Void (refund both stakes)"
          disabled={saving}
          onPress={() => confirm('Void & refund both?', () => run('Voided — stakes refunded', () => pvpChallenges.void(c.id, note)))}
          style={styles.actSpacing}
        />
      )}
      {(isLive || isLocked || c.status === 'settled') && (
        <Button
          variant="outline"
          tone="danger"
          label="Cancel contract"
          disabled={saving}
          onPress={() => confirm('Cancel this contract?', () => run('Cancelled', () => pvpChallenges.cancel(c.id)))}
          style={styles.actSpacing}
        />
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
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
  actSpacing: { marginBottom: 8 },
})
