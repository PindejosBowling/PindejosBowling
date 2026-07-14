import { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native'
import { colors, fonts, radius, sheetStyles } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useAdminAction } from '../../hooks/useAdminAction'
import { pvpChallenges } from '../../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL } from '../../utils/pvp'
import type { PvpChallengeView } from '../../hooks/usePvpData'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Mount conditionally so it resets between opens. Each action → RPC → toast +
  // onDone (reload) + onClose. Maps the design's settle/cancel/void to the live RPCs.
  challenge: PvpChallengeView
  onClose: () => void
  onDone: () => void
}

export default function PvpAdminActionModal({ challenge: c, onClose, onDone }: Props) {
  const [note, setNote] = useState('')
  const { saving, run, confirm: confirmAction } = useAdminAction(onDone, onClose)

  const isLive = c.status === 'pending' || c.status === 'countered'
  const isLocked = c.status === 'locked' || c.status === 'accepted'

  // Every gate in this sheet shares the same warning copy.
  function confirm(title: string, onYes: () => void) {
    confirmAction(title, 'This cannot be undone.', onYes)
  }

  return (
    <BottomSheet
      title={(c.contractType === 'custom' && c.customTitle) || CONTRACT_TYPE_LABEL[c.contractType] || 'Challenge'}
      subtitle={`${c.creatorName} vs ${c.counterpartyName ?? 'Open'} · ${(STATUS_LABEL[c.status] ?? c.status).toUpperCase()} · Pot ${formatPins(c.totalPot)}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </>
      }
    >
      {c.contractType === 'custom' && c.customDescription ? (
        <>
          <Text style={sheetStyles.label}>WIN CONDITION</Text>
          <View style={styles.conditionCard}>
            <Text style={styles.conditionText}>{c.customDescription}</Text>
          </View>
        </>
      ) : null}

      <Text style={sheetStyles.label}>ADMIN NOTE (OPTIONAL)</Text>
      <TextInput
        style={sheetStyles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Reason / adjudication notes…"
        placeholderTextColor={colors.muted2}
        multiline
        maxLength={240}
      />

      {isLocked && (
        <>
          <Text style={sheetStyles.section}>MANUAL SETTLE</Text>
          <Button
            variant="outline"
            label={`${c.creatorName} wins`}
            disabled={saving}
            onPress={() => confirm(`${c.creatorName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.creatorId, note)))}
            style={sheetStyles.actSpacing}
          />
          {c.counterpartyId && (
            <Button
              variant="outline"
              label={`${c.counterpartyName} wins`}
              disabled={saving}
              onPress={() => confirm(`${c.counterpartyName} wins?`, () => run('Settled', () => pvpChallenges.settle(c.id, c.counterpartyId, note)))}
              style={sheetStyles.actSpacing}
            />
          )}
          {c.contractType !== 'custom' && (
            <Button
              variant="outline"
              label="Auto-settle from scores (push if tied)"
              disabled={saving}
              onPress={() => confirm('Auto-settle from scores?', () => run('Settled from scores', () => pvpChallenges.settle(c.id, null, note)))}
              style={sheetStyles.actSpacing}
            />
          )}
        </>
      )}

      <Text style={sheetStyles.section}>RESOLVE / REVERSE</Text>
      {(isLocked || c.status === 'settled') && (
        <Button
          variant="outline"
          tone="danger"
          label="Void (refund both stakes)"
          disabled={saving}
          onPress={() => confirm('Void & refund both?', () => run('Voided — stakes refunded', () => pvpChallenges.void(c.id, note)))}
          style={sheetStyles.actSpacing}
        />
      )}
      {(isLive || isLocked || c.status === 'settled') && (
        <Button
          variant="outline"
          tone="danger"
          label="Cancel contract"
          disabled={saving}
          onPress={() => confirm('Cancel this contract?', () => run('Cancelled', () => pvpChallenges.cancel(c.id)))}
          style={sheetStyles.actSpacing}
        />
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  conditionCard: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  conditionText: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 21 },
})
