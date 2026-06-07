import { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, ScrollView,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { bountyPosts } from '../utils/supabase/db'
import { hunterPayout } from '../utils/bounty'
import type { BountyView } from '../hooks/useBountyBoardData'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → enter RPC → toast +
  // onDone (reload) + onClose. The entry number / protected profit shown are an
  // estimate until the server assigns them under its per-bounty lock (design §16).
  bounty: BountyView
  onClose: () => void
  onDone: () => void
}

export default function BountyEntryModal({ bounty: b, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  const n = b.nextEntryNumber
  const stake = b.hunterStakeAmount
  const profit = b.nextProtectedProfit
  const total = hunterPayout(stake, profit)

  async function confirm() {
    setSaving(true)
    try {
      const { error } = await bountyPosts.enter(b.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast('You joined the hunt', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to join', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Join the Hunt</Text>
          <Text style={styles.subtitle}>{b.title}</Text>

          <ScrollView style={styles.body}>
            <Text style={styles.copy}>You are joining as <Text style={styles.bold}>Hunter #{n}</Text>.</Text>
            <Text style={styles.copy}>You will stake <Text style={styles.bold}>{stake.toLocaleString()}</Text> pins.</Text>
            <Text style={styles.copy}>
              If hunters win, you receive <Text style={styles.bold}>{total.toLocaleString()}</Text> pins total.
            </Text>
            <Text style={styles.copy}>Your protected profit is <Text style={styles.bold}>+{profit.toLocaleString()}</Text> pins.</Text>
            <Text style={styles.copy}>Additional hunters will not reduce your payout.</Text>
            <Text style={styles.note}>
              An admin will manually settle this bounty based on the posted description. The entry number
              shown is an estimate until the server assigns it.
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
              : <Text style={styles.confirmText}>Join & Stake {stake.toLocaleString()}</Text>}
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
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
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3, marginTop: 2, marginBottom: 14 },
  body: { maxHeight: 320 },
  copy: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 24 },
  bold: { fontFamily: fonts.barlowCondensed, color: colors.accent },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 18, marginTop: 12 },
  confirmBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
  cancel: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 14 },
})
