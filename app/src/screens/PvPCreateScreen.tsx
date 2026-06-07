import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import PlayerPickerModal from '../components/PlayerPickerModal'
import Toast from '../components/Toast'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import {
  seasons, weeks, players as playersDb, pinLedger, games, betMarkets, pvpChallenges, CreatePvpArgs,
} from '../utils/supabase/db'
import { normalizeChallenge } from '../hooks/usePvpData'
import {
  PVP_MIN_STAKE, PvpContractType, CONTRACT_TYPE_OPTIONS, CONTRACT_TYPE_RULE, CONTRACT_TYPE_LABEL, formatExpiry,
} from '../utils/pvp'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>
type Rt = RouteProp<PinsinoStackParamList, 'PvPCreate'>

interface OpponentOpt { id: string; name: string }
interface PropMarket { marketId: string; subjectName: string; gameNumber: number | null; line: number | null }

export default function PvPCreateScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Rt>()
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Loaded context
  const [weekId, setWeekId] = useState<string | null>(null)
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [bowledAt, setBowledAt] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [opponents, setOpponents] = useState<OpponentOpt[]>([])
  const [gameNumbers, setGameNumbers] = useState<number[]>([])
  const [propMarkets, setPropMarkets] = useState<PropMarket[]>([])

  // Form state
  const [openBoard, setOpenBoard] = useState(false)
  const [opponentId, setOpponentId] = useState<string | null>(null)
  const [contractType, setContractType] = useState<PvpContractType>('line_duel')
  const [gameNumber, setGameNumber] = useState<number | null>(null)
  const [propMarketId, setPropMarketId] = useState<string | null>(null)
  const [selection, setSelection] = useState<'over' | 'under'>('over')
  const [stake, setStake] = useState('')
  const [message, setMessage] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [seasonRes, weekRes] = await Promise.all([seasons.getCurrent(), weeks.getCurrent()])
      const seasonId = seasonRes.data?.id ?? null
      const wId = weekRes.data?.id ?? null
      setWeekId(wId)
      setWeekNumber(weekRes.data?.week_number ?? null)
      setBowledAt((weekRes.data as any)?.bowled_at ?? null)

      const fetches: PromiseLike<any>[] = []
      let playerRows: any[] = []
      let ledgerRows: any[] = []
      let gameRows: any[] = []
      let marketRows: any[] = []

      fetches.push(playersDb.listActive().then(({ data }) => { playerRows = data ?? [] }))
      if (playerId && seasonId) {
        fetches.push(pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerRows = data ?? [] }))
      }
      if (wId) {
        fetches.push(games.listByWeek(wId).then(({ data }) => { gameRows = data ?? [] }))
        fetches.push(betMarkets.listOpenOUByWeek(wId).then(({ data }) => { marketRows = data ?? [] }))
      }
      await Promise.all(fetches)

      setBalance(ledgerRows.reduce((s, e) => s + e.amount, 0))
      setOpponents(playerRows.filter((p: any) => p.id !== playerId).map((p: any) => ({ id: p.id, name: p.name })))
      const nums = Array.from(new Set(gameRows.map((g: any) => g.game_number))).sort((a, b) => a - b)
      setGameNumbers(nums)
      setGameNumber(prev => prev ?? nums[0] ?? null)
      setPropMarkets(marketRows.map((m: any) => ({
        marketId: m.id,
        subjectName: m.subject?.name ?? '—',
        gameNumber: m.game_number ?? null,
        line: m.bet_selections?.[0]?.line != null ? Number(m.bet_selections[0].line) : null,
      })))

      // Rematch prefill: inherit type + opponent, double the stake (§7 v1 default).
      if (route.params?.rematchOfId) {
        const { data } = await pvpChallenges.getById(route.params.rematchOfId)
        if (data) {
          const c = normalizeChallenge(data)
          setContractType(c.contractType as PvpContractType)
          setGameNumber(c.gameNumber ?? nums[0] ?? null)
          setStake(String(c.creatorStake * 2))
          const other = c.creatorId === playerId ? c.counterpartyId : c.creatorId
          if (other) setOpponentId(other)
          if (c.contractType === 'prop_duel' && c.propMarketId) setPropMarketId(c.propMarketId)
        }
      } else if (route.params?.opponentId) {
        setOpponentId(route.params.opponentId)
      }
    } catch (e) {
      console.error('PvPCreate load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [playerId])
  const { refreshing, onRefresh } = useRefresh(load)

  const stakeNum = parseInt(stake, 10)
  const validStake = !isNaN(stakeNum) && stakeNum >= PVP_MIN_STAKE && stakeNum <= balance
  const opponentName = useMemo(
    () => opponents.find(o => o.id === opponentId)?.name ?? null,
    [opponents, opponentId],
  )
  const selectedProp = useMemo(
    () => propMarkets.find(m => m.marketId === propMarketId) ?? null,
    [propMarkets, propMarketId],
  )

  const isProp = contractType === 'prop_duel'

  function validate(): string | null {
    if (!weekId) return 'No active week to challenge in'
    if (!openBoard && !opponentId) return 'Pick an opponent or post to the open board'
    if (isNaN(stakeNum) || stakeNum < PVP_MIN_STAKE) return `Minimum stake is ${PVP_MIN_STAKE} pins`
    if (stakeNum > balance) return 'Stake exceeds your balance'
    if (isProp) {
      if (!propMarketId) return 'Pick a prop market'
    } else if (gameNumber == null) {
      return 'Pick a game'
    }
    return null
  }

  async function submit() {
    const err = validate()
    if (err) { showToast(err, 'error'); return }
    setSubmitting(true)
    try {
      const args: CreatePvpArgs = {
        contractType,
        counterpartyId: openBoard ? null : opponentId,
        weekId: weekId!,
        gameNumber: isProp ? null : gameNumber,
        stake: stakeNum,
        propMarketId: isProp ? propMarketId : null,
        creatorSelection: isProp ? selection : null,
        message: message.trim() || null,
        expiresAt: null, // server defaults to the week's bowled_at lock
      }
      const { data, error } = await pvpChallenges.create(args)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Challenge sent', 'success')
      const newId = data as unknown as string
      if (newId) navigation.replace('PvPChallengeDetail', { challengeId: newId })
      else navigation.goBack()
    } catch {
      showToast('Failed to create challenge', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  const pot = isNaN(stakeNum) ? 0 : stakeNum * 2

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New Challenge" subtitle="Set your terms" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Opponent */}
        <Text style={styles.label}>OPPONENT</Text>
        <View style={styles.opponentRow}>
          <TouchableOpacity
            style={[styles.opponentBtn, openBoard && styles.opponentBtnDisabled]}
            onPress={() => setPickerOpen(true)}
            disabled={openBoard}
            activeOpacity={0.7}
          >
            <Text style={styles.opponentBtnText}>{opponentName ?? 'Select player…'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.boardToggle, openBoard && styles.boardToggleOn]}
            onPress={() => setOpenBoard(o => !o)}
            activeOpacity={0.7}
          >
            <Text style={[styles.boardToggleText, openBoard && styles.boardToggleTextOn]}>Open board</Text>
          </TouchableOpacity>
        </View>

        {/* Contract type */}
        <Text style={styles.label}>CONTRACT TYPE</Text>
        <ToggleGroup options={CONTRACT_TYPE_OPTIONS} value={contractType} onChange={k => setContractType(k as PvpContractType)} style={styles.toggle} />

        {/* Scope */}
        <Text style={styles.label}>WEEK {weekNumber ?? '—'} · SCOPE</Text>
        {isProp ? (
          <View>
            {propMarkets.length === 0 ? (
              <Text style={styles.helpText}>No open prop markets this week.</Text>
            ) : (
              propMarkets.map(m => (
                <TouchableOpacity
                  key={m.marketId}
                  style={[styles.propRow, propMarketId === m.marketId && styles.propRowOn]}
                  onPress={() => setPropMarketId(m.marketId)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.propName}>
                    {m.subjectName}{m.gameNumber != null ? ` · G${m.gameNumber}` : ''}
                  </Text>
                  <Text style={styles.propLine}>O/U {m.line != null ? m.line.toFixed(1) : '—'}</Text>
                </TouchableOpacity>
              ))
            )}
            {propMarketId && (
              <>
                <Text style={[styles.label, { marginTop: 14 }]}>YOUR SIDE</Text>
                <ToggleGroup
                  options={[{ key: 'over', label: 'Over' }, { key: 'under', label: 'Under' }]}
                  value={selection}
                  onChange={k => setSelection(k as 'over' | 'under')}
                  style={styles.toggle}
                />
              </>
            )}
          </View>
        ) : (
          <View style={styles.gameRow}>
            {gameNumbers.length === 0 ? (
              <Text style={styles.helpText}>No games scheduled this week.</Text>
            ) : (
              gameNumbers.map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.gameBtn, gameNumber === n && styles.gameBtnOn]}
                  onPress={() => setGameNumber(n)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.gameBtnText, gameNumber === n && styles.gameBtnTextOn]}>Game {n}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Stake */}
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
        <Text style={styles.helpText}>Balance: {balance.toLocaleString()} pins</Text>

        {/* Message */}
        <Text style={styles.label}>MESSAGE (OPTIONAL)</Text>
        <TextInput
          style={[styles.input, styles.messageInput]}
          value={message}
          onChangeText={setMessage}
          placeholder="Talk some trash…"
          placeholderTextColor={colors.muted2}
          multiline
          maxLength={240}
        />

        {/* Confirmation panel */}
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{CONTRACT_TYPE_LABEL[contractType]}</Text>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Your stake</Text>
            <Text style={styles.confirmValue}>{validStake ? stakeNum.toLocaleString() : '—'} pins</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Total pot</Text>
            <Text style={styles.confirmValueAccent}>{pot.toLocaleString()} pins</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Winner's payout</Text>
            <Text style={styles.confirmValueAccent}>{pot.toLocaleString()} pins</Text>
          </View>
          <Text style={styles.confirmRule}>{CONTRACT_TYPE_RULE[contractType]}</Text>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Locks at</Text>
            <Text style={styles.confirmValue}>{bowledAt ? formatExpiry(bowledAt) : 'week lock'}</Text>
          </View>
          <Text style={styles.confirmNote}>
            Winner takes the whole pot — no house cut. This does not affect bowling gameplay — always bowl your best.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (submitting || !validStake) && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={submitting || !validStake}
          activeOpacity={0.7}
        >
          <Text style={styles.submitBtnText}>{openBoard ? 'Post Challenge' : 'Send Challenge'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PlayerPickerModal
        visible={pickerOpen}
        players={opponents.map(o => o.name)}
        title="Select Opponent"
        onSelect={name => {
          const o = opponents.find(p => p.name === name)
          setOpponentId(o?.id ?? null)
          setOpenBoard(false)
          setPickerOpen(false)
        }}
        onClose={() => setPickerOpen(false)}
      />
      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 60 },

  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
    marginTop: 18,
    marginBottom: 8,
  },
  toggle: { justifyContent: 'flex-start' },

  opponentRow: { flexDirection: 'row', gap: 8 },
  opponentBtn: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  opponentBtnDisabled: { opacity: 0.4 },
  opponentBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  boardToggle: {
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  boardToggleOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  boardToggleText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  boardToggleTextOn: { color: colors.accent },

  gameRow: { flexDirection: 'row', gap: 8 },
  gameBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  gameBtnOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  gameBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.5 },
  gameBtnTextOn: { color: colors.accent },

  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  propRowOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  propName: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  propLine: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted },

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
  messageInput: { fontFamily: fonts.barlow, fontSize: 15, minHeight: 60, textAlignVertical: 'top' },
  helpText: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },

  confirmCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginTop: 24,
  },
  confirmTitle: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.text, fontWeight: '700', marginBottom: 10 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  confirmLabel: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted },
  confirmValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  confirmValueAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 16, color: colors.accent },
  confirmRule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginVertical: 6 },
  confirmNote: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2, lineHeight: 17, marginTop: 6 },

  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
})
