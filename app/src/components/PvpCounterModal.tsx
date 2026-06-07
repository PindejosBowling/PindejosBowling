import { useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { pvpChallenges, CounterPvpArgs } from '../utils/supabase/db'
import { PVP_MIN_STAKE, CONTRACT_TYPE_LABEL } from '../utils/pvp'
import type { PvpChallengeView } from '../hooks/usePvpData'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → counter RPC → toast +
  // onDone (reload) + onClose. Counters the stake/scope; type + prop side inherit
  // from the current contract.
  challenge: PvpChallengeView
  balance: number
  onClose: () => void
  onDone: () => void
}

export default function PvpCounterModal({ challenge: c, balance, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)
  const [stake, setStake] = useState(String(c.creatorStake))
  const [game, setGame] = useState(c.gameNumber != null ? String(c.gameNumber) : '')
  const [message, setMessage] = useState('')

  // Prop and custom contracts have no game scope — the counter renegotiates the
  // stake only (custom keeps its title/win-condition; prop keeps its market side).
  const noGame = c.contractType === 'prop_duel' || c.contractType === 'custom'
  const stakeNum = parseInt(stake, 10)
  const validStake = !isNaN(stakeNum) && stakeNum >= PVP_MIN_STAKE && stakeNum <= balance
  const pot = isNaN(stakeNum) ? 0 : stakeNum * 2

  async function confirm() {
    if (!validStake) {
      showToast(stakeNum > balance ? 'Stake exceeds your balance' : `Minimum stake is ${PVP_MIN_STAKE} pins`, 'error')
      return
    }
    const gameNum = noGame ? null : parseInt(game, 10)
    if (!noGame && (gameNum == null || isNaN(gameNum))) { showToast('Enter a game number', 'error'); return }

    setSaving(true)
    try {
      const args: CounterPvpArgs = {
        challengeId: c.id,
        stake: stakeNum,
        contractType: c.contractType,
        gameNumber: gameNum,
        propMarketId: c.propMarketId,
        selection: c.creatorSelection,
        message: message.trim() || null,
      }
      const { error } = await pvpChallenges.counter(args)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Counteroffer sent', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to counter', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Counter {CONTRACT_TYPE_LABEL[c.contractType]}</Text>
          <Text style={styles.subtitle}>vs {c.creatorName}</Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>STAKE (MIN {PVP_MIN_STAKE})</Text>
            <TextInput
              style={styles.input}
              value={stake}
              onChangeText={v => setStake(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder={`${PVP_MIN_STAKE}`}
              placeholderTextColor={colors.muted2}
              maxLength={7}
            />
            <Text style={styles.help}>Balance: {balance.toLocaleString()} pins</Text>

            {!noGame && (
              <>
                <Text style={styles.label}>GAME</Text>
                <TextInput
                  style={styles.input}
                  value={game}
                  onChangeText={v => setGame(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.muted2}
                  maxLength={2}
                />
              </>
            )}

            <Text style={styles.label}>MESSAGE (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.messageInput]}
              value={message}
              onChangeText={setMessage}
              placeholder="Your terms…"
              placeholderTextColor={colors.muted2}
              multiline
              maxLength={240}
            />

            <View style={styles.potRow}>
              <Text style={styles.potLabel}>New pot (winner takes all)</Text>
              <Text style={styles.potValue}>{pot.toLocaleString()} pins</Text>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, (saving || !validStake) && styles.confirmBtnDisabled]}
            onPress={confirm}
            disabled={saving || !validStake}
            activeOpacity={0.7}
          >
            {saving
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.confirmText}>Send Counteroffer</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5, marginTop: 2, marginBottom: 8 },
  body: { maxHeight: 380 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
  },
  messageInput: { fontFamily: fonts.barlow, fontSize: 15, minHeight: 56, textAlignVertical: 'top' },
  help: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
  potRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 },
  potLabel: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted },
  potValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },
  confirmBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
})
