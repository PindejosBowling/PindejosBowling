import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import StatRow from '../ui/StatRow'
import { useUiStore } from '../../stores/uiStore'
import { useAdminAction } from '../../hooks/useAdminAction'
import { bountyPosts } from '../../utils/supabase/db'
import { bountyEconomics, hunterPayout } from '../../utils/bounty'
import type { BountyView } from '../../hooks/useBountyBoardData'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Mount conditionally so it resets between opens. Each action → RPC → toast +
  // onDone (reload) + onClose. Settle requires reasoning; the admin never enters
  // amounts (design §8, §25.5).
  bounty: BountyView
  onClose: () => void
  onDone: () => void
}

export default function BountyAdminActionModal({ bounty: b, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [reasoning, setReasoning] = useState('')
  const { saving, run, confirm } = useAdminAction(onDone, onClose)

  const econ = useMemo(() => bountyEconomics(b.rewardPerHunter, b.hunters), [b])

  function settle(outcome: 'sponsor_win' | 'hunter_win', label: string) {
    if (!reasoning.trim()) { showToast('Settlement reasoning is required', 'error'); return }
    confirm(
      `${label}?`,
      'This pays out and closes the bounty.',
      () => run('Bounty settled', () => bountyPosts.settle(b.id, outcome, reasoning.trim())),
      false,
    )
  }

  function cancel() {
    const msg = b.status === 'settled'
      ? 'This erases the bounty economically and publicly — every payout from settlement is clawed back as if it never happened. This cannot be undone.'
      : 'This erases the bounty economically and publicly — all escrow is refunded as if it never happened. This cannot be undone.'
    Alert.alert(
      'Cancel this bounty?',
      msg,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Erase bounty', style: 'destructive', onPress: () => run('Bounty cancelled', () => bountyPosts.cancel(b.id)) },
      ],
    )
  }

  const sponsorLabel = b.bountyType === 'house_bounty' ? 'The Pinsino' : (b.sponsorName ?? '—')

  return (
    <BottomSheet
      title={b.title}
      subtitle={`${sponsorLabel} · ${b.status.toUpperCase()} · ${b.hunterCount} hunter${b.hunterCount === 1 ? '' : 's'}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      bodyMaxHeight={460}
      footer={
        // Cancel lives in the footer (outside the scrollable body) so the
        // destructive action is always on screen at load — an admin must be able
        // to erase a bounty without scrolling past CLOSE / SETTLE / hunter rows.
        <>
          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="outline" tone="danger" label="Cancel (erase bounty)" disabled={saving} onPress={cancel} style={styles.actSpacing} />
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </>
      }
    >
      {b.status === 'open' && (
        <>
          <Text style={styles.section}>CLOSE</Text>
          <Button
            variant="outline"
            label="Close to new hunters"
            disabled={saving}
            onPress={() => run('Bounty closed', () => bountyPosts.close(b.id))}
            style={styles.actSpacing}
          />
        </>
      )}

      {b.status !== 'settled' && (
        <>
          <Text style={styles.section}>SETTLE</Text>
          <Text style={styles.label}>SETTLEMENT REASONING (REQUIRED, PUBLIC)</Text>
          <TextInput
            style={styles.input}
            value={reasoning}
            onChangeText={setReasoning}
            placeholder="Explain the outcome — shown publicly on the bounty."
            placeholderTextColor={colors.muted2}
            multiline
            maxLength={1000}
          />

          <View style={styles.previewCard}>
            <StatRow label="Sponsor wins → sponsor keeps" value={formatPins(econ.sponsorTakeOnWin)} />
            {b.hunters.map(h => (
              <StatRow
                key={h.id}
                label={`Hunters win → ${h.playerName ?? `Hunter #${h.entryNumber}`}`}
                value={formatPins(hunterPayout(h.stakeAmount, b.rewardPerHunter))}
              />
            ))}
            {b.bountyType === 'house_bounty' && (
              <StatRow label="House subsidy (hunter win)" value={formatPins(econ.totalReward)} />
            )}
          </View>

          <Button variant="outline" label="Sponsor Wins" disabled={saving} onPress={() => settle('sponsor_win', 'Sponsor wins')} style={styles.actSpacing} />
          <Button variant="outline" label="Hunters Win" disabled={saving} onPress={() => settle('hunter_win', 'Hunters win')} style={styles.actSpacing} />
        </>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
    minHeight: 70, textAlignVertical: 'top',
  },
  previewCard: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2, marginTop: 12, marginBottom: 4,
  },
  actSpacing: { marginBottom: 8 },
})
