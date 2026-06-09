import { useMemo, useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import Button from './Button'
import { useUiStore } from '../stores/uiStore'
import { bountyPosts } from '../utils/supabase/db'
import { bountyEconomics, hunterPayout } from '../utils/bounty'
import type { BountyView } from '../hooks/useBountyBoardData'

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
  const [saving, setSaving] = useState(false)

  const econ = useMemo(() => bountyEconomics(b.rewardPerHunter, b.hunters), [b])

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

  function settle(outcome: 'sponsor_win' | 'hunter_win', label: string) {
    if (!reasoning.trim()) { showToast('Settlement reasoning is required', 'error'); return }
    Alert.alert(`${label}?`, 'This pays out and closes the bounty.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => run('Bounty settled', () => bountyPosts.settle(b.id, outcome, reasoning.trim())) },
    ])
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
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{b.title}</Text>
          <Text style={styles.subtitle}>
            {sponsorLabel} · {b.status.toUpperCase()} · {b.hunterCount} hunter{b.hunterCount === 1 ? '' : 's'}
          </Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {b.status === 'open' && (
              <>
                <Text style={styles.section}>CLOSE</Text>
                <TouchableOpacity
                  style={styles.actBtn}
                  disabled={saving}
                  onPress={() => run('Bounty closed', () => bountyPosts.close(b.id))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actText}>Close to new hunters</Text>
                </TouchableOpacity>
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
                  <View style={styles.kv}><Text style={styles.muted}>Sponsor wins → sponsor keeps</Text><Text style={styles.kvValue}>{econ.sponsorTakeOnWin.toLocaleString()}</Text></View>
                  {b.hunters.map(h => (
                    <View key={h.id} style={styles.kv}>
                      <Text style={styles.muted}>Hunters win → {h.playerName ?? `Hunter #${h.entryNumber}`}</Text>
                      <Text style={styles.kvValue}>{hunterPayout(h.stakeAmount, b.rewardPerHunter).toLocaleString()}</Text>
                    </View>
                  ))}
                  {b.bountyType === 'house_bounty' && (
                    <View style={styles.kv}><Text style={styles.muted}>House subsidy (hunter win)</Text><Text style={styles.kvValue}>{econ.totalReward.toLocaleString()}</Text></View>
                  )}
                </View>

                <TouchableOpacity style={styles.actBtn} disabled={saving} onPress={() => settle('sponsor_win', 'Sponsor wins')} activeOpacity={0.7}>
                  <Text style={styles.actText}>Sponsor Wins</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actBtn} disabled={saving} onPress={() => settle('hunter_win', 'Hunters win')} activeOpacity={0.7}>
                  <Text style={styles.actText}>Hunters Win</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.section}>DESTRUCTIVE</Text>
            <TouchableOpacity style={[styles.actBtn, styles.dangerBtn]} disabled={saving} onPress={cancel} activeOpacity={0.7}>
              <Text style={styles.dangerText}>Cancel (erase bounty)</Text>
            </TouchableOpacity>
          </ScrollView>

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
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3, marginTop: 2, marginBottom: 8 },
  body: { maxHeight: 460 },
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
    minHeight: 70, textAlignVertical: 'top',
  },
  previewCard: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 12, marginBottom: 4,
  },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, flex: 1, marginRight: 8 },
  actBtn: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingVertical: 13, alignItems: 'center', marginBottom: 8,
  },
  actText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, letterSpacing: 0.5 },
  dangerBtn: { borderColor: colors.danger },
  dangerText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.danger, letterSpacing: 0.5 },
})
