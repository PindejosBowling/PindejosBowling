import { useEffect, useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { pvpChallenges, seasons, games, CounterPvpArgs } from '../utils/supabase/db'
import LineDuelLines from './LineDuelLines'
import GamePicker from './GamePicker'
import { PVP_MIN_STAKE, CONTRACT_TYPE_LABEL } from '../utils/pvp'
import type { PvpChallengeView } from '../hooks/usePvpData'

interface Props {
  // Mount conditionally so it resets between opens. Confirm → counter RPC → toast +
  // onDone (reload) + onClose. Counters the stakes/scope; type + prop side inherit
  // from the current contract. viewerId maps the viewer-relative "your / opponent"
  // inputs onto the role-fixed creator/counterparty stakes the RPC expects.
  challenge: PvpChallengeView
  viewerId: string | null
  balance: number
  onClose: () => void
  onDone: () => void
}

export default function PvpCounterModal({ challenge: c, viewerId, balance, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  const iAmCreator = viewerId != null && viewerId === c.creatorId
  const myPrior = iAmCreator ? c.creatorStake : c.counterpartyStake
  const oppPrior = iAmCreator ? c.counterpartyStake : c.creatorStake

  const [stake, setStake] = useState(String(myPrior))
  const [customStakes, setCustomStakes] = useState(myPrior !== oppPrior)
  const [opponentStake, setOpponentStake] = useState(String(oppPrior))
  const [game, setGame] = useState<number | null>(c.gameNumber)
  const [gameNumbers, setGameNumbers] = useState<number[]>([])
  const [message, setMessage] = useState('')

  // Line Duel lines-to-beat, from the viewer's perspective. Both come off the
  // contract once snapshotted; the open-board taker (whose side is still null)
  // gets their own line previewed so the win condition is clear before they act.
  const isLineDuel = c.contractType === 'line_duel'
  const myLine = iAmCreator ? c.creatorLine : c.counterpartyLine
  const oppLine = iAmCreator ? c.counterpartyLine : c.creatorLine
  const oppName = iAmCreator ? (c.counterpartyName ?? 'Taker') : c.creatorName
  const [takerLine, setTakerLine] = useState<number | null>(null)
  useEffect(() => {
    if (!isLineDuel || myLine != null || !viewerId) return
    let active = true
    seasons.getCurrent().then(({ data }) => {
      const seasonId = data?.id
      if (!seasonId) return
      pvpChallenges.projectedLine(viewerId, seasonId).then(({ data: line }) => {
        if (active) setTakerLine(line != null ? Number(line) : null)
      })
    })
    return () => { active = false }
  }, [isLineDuel, myLine, viewerId])
  const myLineShown = myLine ?? takerLine

  // Game-scoped contracts only — load the week's scheduled games so the counter
  // can only re-pick from what's actually available (no free-form entry).
  const gameScoped = c.contractType !== 'prop_duel' && c.contractType !== 'custom'
  useEffect(() => {
    if (!gameScoped) return
    let active = true
    games.listByWeek(c.weekId).then(({ data }) => {
      if (!active) return
      const nums = Array.from(new Set((data ?? []).map((g: any) => g.game_number))).sort((a, b) => a - b)
      setGameNumbers(nums)
      setGame(prev => prev ?? nums[0] ?? null)
    })
    return () => { active = false }
  }, [gameScoped, c.weekId])

  // Prop and custom contracts have no game scope — the counter renegotiates the
  // stakes only (custom keeps its title/win-condition; prop keeps its market side).
  const noGame = c.contractType === 'prop_duel' || c.contractType === 'custom'
  const stakeNum = parseInt(stake, 10)
  const oppStakeNum = customStakes ? parseInt(opponentStake, 10) : stakeNum
  const validMyStake = !isNaN(stakeNum) && stakeNum >= PVP_MIN_STAKE && stakeNum <= balance
  const validOppStake = !isNaN(oppStakeNum) && oppStakeNum >= PVP_MIN_STAKE
  const validStake = validMyStake && validOppStake
  const pot = validStake ? stakeNum + oppStakeNum : 0

  async function confirm() {
    if (!validMyStake) {
      showToast(stakeNum > balance ? 'Stake exceeds your balance' : `Minimum stake is ${PVP_MIN_STAKE} pins`, 'error')
      return
    }
    if (!validOppStake) { showToast(`Opponent's stake must be at least ${PVP_MIN_STAKE} pins`, 'error'); return }
    const gameNum = noGame ? null : game
    if (!noGame && gameNum == null) { showToast('Pick a game', 'error'); return }

    setSaving(true)
    try {
      const args: CounterPvpArgs = {
        challengeId: c.id,
        // Map viewer-relative → role-fixed stakes.
        creatorStake: iAmCreator ? stakeNum : oppStakeNum,
        counterpartyStake: iAmCreator ? oppStakeNum : stakeNum,
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
            <View style={styles.stakeHeader}>
              <Text style={[styles.label, styles.stakeLabel]}>{customStakes ? 'YOUR STAKE' : 'STAKE'} (MIN {PVP_MIN_STAKE})</Text>
              <TouchableOpacity
                style={[styles.customToggle, customStakes && styles.customToggleOn]}
                onPress={() => setCustomStakes(o => !o)}
                activeOpacity={0.7}
              >
                <Text style={[styles.customToggleText, customStakes && styles.customToggleTextOn]}>Custom stakes</Text>
              </TouchableOpacity>
            </View>
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

            {customStakes && (
              <>
                <Text style={styles.label}>OPPONENT'S STAKE (MIN {PVP_MIN_STAKE})</Text>
                <TextInput
                  style={styles.input}
                  value={opponentStake}
                  onChangeText={v => setOpponentStake(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder={`${PVP_MIN_STAKE}`}
                  placeholderTextColor={colors.muted2}
                  maxLength={7}
                />
              </>
            )}

            {!noGame && (
              <>
                <Text style={styles.label}>GAME</Text>
                <GamePicker games={gameNumbers} value={game} onChange={setGame} />
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

            {isLineDuel && (
              <LineDuelLines
                sides={[
                  { name: 'Your line', value: myLineShown != null ? myLineShown.toFixed(1) : '—' },
                  { name: oppName, value: oppLine != null ? oppLine.toFixed(1) : '—' },
                ]}
              />
            )}

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
  stakeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stakeLabel: { flex: 1 },
  customToggle: { borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2, paddingHorizontal: 12, paddingVertical: 6 },
  customToggleOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  customToggleText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  customToggleTextOn: { color: colors.accent },
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
