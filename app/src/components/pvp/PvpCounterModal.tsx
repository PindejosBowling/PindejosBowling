import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { pvpChallenges, seasons, games, CounterPvpArgs } from '../../utils/supabase/db'
import LineDuelLines from './LineDuelLines'
import GamePicker from '../ui/GamePicker'
import PinAmountInput from '../ui/PinAmountInput'
import { PVP_MIN_STAKE, CONTRACT_TYPE_LABEL, formatHandicap, sanitizeHandicap } from '../../utils/pvp'
import type { PvpChallengeView } from '../../hooks/usePvpData'
import { formatPins } from '../../utils/formatting'

// Names in this sheet sit in tight spots (a column header above an input, inline
// labels) where a full name wraps and displaces the fields — use the first name only.
const firstName = (name: string) => name.split(' ')[0]

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
  const oppName = iAmCreator ? (c.counterpartyName ? firstName(c.counterpartyName) : 'Taker') : firstName(c.creatorName)
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

  // Head-to-Head handicaps, viewer-relative and renegotiable like the stakes.
  const isHeadToHead = c.contractType === 'head_to_head'
  const [myHandicap, setMyHandicap] = useState(
    String((iAmCreator ? c.creatorHandicap : c.counterpartyHandicap) || ''),
  )
  const [oppHandicap, setOppHandicap] = useState(
    String((iAmCreator ? c.counterpartyHandicap : c.creatorHandicap) || ''),
  )
  const myHandicapNum = parseInt(myHandicap, 10) || 0
  const oppHandicapNum = parseInt(oppHandicap, 10) || 0

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
        // Map viewer-relative → role-fixed handicaps (0 for non-head_to_head).
        creatorHandicap: isHeadToHead ? (iAmCreator ? myHandicapNum : oppHandicapNum) : 0,
        counterpartyHandicap: isHeadToHead ? (iAmCreator ? oppHandicapNum : myHandicapNum) : 0,
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
    <BottomSheet
      title={`Counter ${CONTRACT_TYPE_LABEL[c.contractType]}`}
      subtitle={`vs ${firstName(c.creatorName)}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      bodyMaxHeight={380}
      footer={
        <Button
          label="Send Counteroffer"
          size="lg"
          onPress={confirm}
          loading={saving}
          disabled={saving || !validStake}
          style={styles.confirmBtn}
        />
      }
    >
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
      <PinAmountInput
        variant="stake"
        value={stake}
        onChangeText={setStake}
        placeholder={`${PVP_MIN_STAKE}`}
        maxLength={7}
      />
      <Text style={styles.help}>Balance: {formatPins(balance)} pins</Text>

      {customStakes && (
        <>
          <Text style={styles.label}>OPPONENT'S STAKE (MIN {PVP_MIN_STAKE})</Text>
          <PinAmountInput
            variant="stake"
            value={opponentStake}
            onChangeText={setOpponentStake}
            placeholder={`${PVP_MIN_STAKE}`}
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

      {isHeadToHead && (
        <>
          <View style={styles.handicapRow}>
            <View style={styles.handicapCell}>
              <Text style={styles.label} numberOfLines={1}>YOUR HANDICAP</Text>
              <TextInput
                style={styles.input}
                value={myHandicap}
                onChangeText={v => setMyHandicap(sanitizeHandicap(v))}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={colors.muted2}
                maxLength={4}
              />
            </View>
            <View style={styles.handicapCell}>
              <Text style={styles.label} numberOfLines={1}>{oppName.toUpperCase()}'S HANDICAP</Text>
              <TextInput
                style={styles.input}
                value={oppHandicap}
                onChangeText={v => setOppHandicap(sanitizeHandicap(v))}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={colors.muted2}
                maxLength={4}
              />
            </View>
          </View>
          <LineDuelLines
            label="HANDICAPS"
            sides={[
              { name: 'You', value: formatHandicap(myHandicapNum) },
              { name: oppName, value: formatHandicap(oppHandicapNum) },
            ]}
          />
        </>
      )}

      <View style={styles.potRow}>
        <Text style={styles.potLabel}>New pot (winner takes all)</Text>
        <Text style={styles.potValue}>{formatPins(pot)} pins</Text>
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  stakeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stakeLabel: { flex: 1 },
  handicapRow: { flexDirection: 'row', gap: 8 },
  handicapCell: { flex: 1 },
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
  confirmBtn: { marginTop: 18 },
})
