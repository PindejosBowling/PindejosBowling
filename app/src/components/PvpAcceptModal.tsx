import { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, ScrollView,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { pvpChallenges } from '../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPE_RULE } from '../utils/pvp'
import type { PvpChallengeView } from '../hooks/usePvpData'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → accept RPC → toast +
  // onDone (reload) + onClose. Accepting = accepting the full revised contract.
  challenge: PvpChallengeView
  viewerId: string | null
  onClose: () => void
  onDone: () => void
}

export default function PvpAcceptModal({ challenge: c, viewerId, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  // The viewer accepts the *other* side's offer. Stakes may be asymmetric, so show
  // both: the viewer's own side and the opponent's.
  const iAmCreator = viewerId != null && viewerId === c.creatorId
  const myStake = iAmCreator ? c.creatorStake : c.counterpartyStake
  const oppStake = iAmCreator ? c.counterpartyStake : c.creatorStake

  async function confirm() {
    setSaving(true)
    try {
      const { error } = await pvpChallenges.accept(c.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Challenge accepted', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to accept', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Accept {CONTRACT_TYPE_LABEL[c.contractType]}</Text>
          <Text style={styles.subtitle}>vs {c.creatorName} · {c.gameNumber != null ? `Game ${c.gameNumber}` : 'Series'}</Text>

          <ScrollView style={styles.body}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Your stake</Text>
              <Text style={styles.rowValue}>{myStake.toLocaleString()} pins</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Opponent's stake</Text>
              <Text style={styles.rowValue}>{oppStake.toLocaleString()} pins</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Total pot</Text>
              <Text style={styles.rowValueAccent}>{c.totalPot.toLocaleString()} pins</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Winner's payout</Text>
              <Text style={styles.rowValueAccent}>{c.payoutAmount.toLocaleString()} pins</Text>
            </View>
            <Text style={styles.rule}>{CONTRACT_TYPE_RULE[c.contractType]}</Text>
            <Text style={styles.note}>
              Accepting escrows your stake immediately and locks the contract. It settles automatically
              when the week is archived. Winner takes the whole pot.
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, saving && styles.confirmBtnDisabled]}
            onPress={confirm}
            disabled={saving}
            activeOpacity={0.7}
          >
            {saving
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.confirmText}>Accept & Stake {myStake.toLocaleString()}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => !saving && onClose()} activeOpacity={0.7}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5, marginTop: 2, marginBottom: 14 },
  body: { maxHeight: 320 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  rowLabel: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted },
  rowValue: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  rowValueAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },
  rule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 6 },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 17, marginTop: 10 },
  confirmBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
  cancel: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 14 },
})
