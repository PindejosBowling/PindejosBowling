import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { betMarkets } from '../utils/supabase/db'
import type { BetView } from '../hooks/useBettingData'

interface SettleBetModalProps {
  // The bet whose line is being settled. Settling resolves *every* bet on that
  // market (over_under is one market per player×game). Mount conditionally
  // (`{bet && <SettleBetModal …/>}`) so the input resets between opens.
  bet: BetView
  onClose: () => void
  onSettled: () => void
}

// Admin manual single-market settlement (settle_market RPC) — sets the result
// from the subject's actual score and pays out every bet on the line at once.
export default function SettleBetModal({ bet, onClose, onSettled }: SettleBetModalProps) {
  const { showToast } = useUiStore()
  const [actual, setActual] = useState('')
  const [settling, setSettling] = useState(false)

  const preview = actual !== ''
    ? (() => {
        const a = parseInt(actual, 10)
        if (isNaN(a)) return null
        return a > bet.line ? 'OVER' : a < bet.line ? 'UNDER' : 'PUSH'
      })()
    : null

  async function settle() {
    const a = parseInt(actual, 10)
    if (isNaN(a) || a < 0 || a > 300) {
      showToast('Enter a valid score (0–300)', 'error'); return
    }
    setSettling(true)
    try {
      const { error } = await betMarkets.settle(bet.marketId, a)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Bet settled', 'success')
      onSettled()
      onClose()
    } catch {
      showToast('Failed to settle bet', 'error')
    } finally {
      setSettling(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !settling && onClose()}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => !settling && onClose()}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            Settle — {bet.subjectName} Game {bet.gameNumber}
          </Text>
          <Text style={styles.modalLine}>LINE: {bet.line.toFixed(1)}</Text>

          <Text style={styles.wagerLabel}>ACTUAL SCORE</Text>
          <TextInput
            style={styles.wagerInput}
            value={actual}
            onChangeText={v => setActual(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="0 – 300"
            placeholderTextColor={colors.muted2}
            maxLength={3}
          />
          <Text style={styles.wagerHint}>
            {preview
              ? `Result: ${preview} — resolves all bets on this line`
              : `${bet.subjectName}'s actual score for game ${bet.gameNumber}`}
          </Text>

          <TouchableOpacity
            style={[styles.placeBtn, settling && styles.placeBtnDisabled]}
            onPress={settle}
            disabled={settling}
            activeOpacity={0.7}
          >
            {settling
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.placeBtnText}>Settle Bet</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalLine: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 20,
  },
  wagerLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  wagerInput: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    letterSpacing: 1,
  },
  wagerHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 20,
  },
  placeBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  placeBtnDisabled: { opacity: 0.4 },
  placeBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
})
