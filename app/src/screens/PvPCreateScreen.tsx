import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
} from 'react-native'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import ToggleGroup from '../components/ui/ToggleGroup'
import PlayerPickerModal from '../components/ui/PlayerPickerModal'
import Button from '../components/ui/Button'
import LineDuelLines from '../components/pvp/LineDuelLines'
import GamePicker from '../components/ui/GamePicker'
import PinAmountInput from '../components/ui/PinAmountInput'
import Toast from '../components/ui/Toast'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import {
  seasons, weeks, players as playersDb, pinLedger, games, betMarkets, pvpChallenges, CreatePvpArgs,
} from '../utils/supabase/db'
import { normalizeChallenge } from '../hooks/usePvpData'
import {
  PVP_MIN_STAKE, PvpContractType, CONTRACT_TYPE_OPTIONS, CONTRACT_TYPE_RULE, CONTRACT_TYPE_LABEL,
  formatHandicap, sanitizeHandicap,
} from '../utils/pvp'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

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
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  // Line Duel lines-to-beat (snapshotted on the contract at create). My line is
  // always known; the opponent's is known only once a specific opponent is set.
  const [myLine, setMyLine] = useState<number | null>(null)
  const [opponentLine, setOpponentLine] = useState<number | null>(null)
  // Head-to-Head handicaps (signed pins added to each player's score; blank = 0).
  // Creator-defined for both sides up front, even on an open board.
  const [myHandicap, setMyHandicap] = useState('')
  const [opponentHandicap, setOpponentHandicap] = useState('')
  const [opponents, setOpponents] = useState<OpponentOpt[]>([])
  const [gameNumbers, setGameNumbers] = useState<number[]>([])
  const [propMarkets, setPropMarkets] = useState<PropMarket[]>([])

  // Form state
  const [openBoard, setOpenBoard] = useState(route.params?.openBoard ?? false)
  const [opponentId, setOpponentId] = useState<string | null>(null)
  const [contractType, setContractType] = useState<PvpContractType>('line_duel')
  const [gameNumber, setGameNumber] = useState<number | null>(null)
  const [propMarketId, setPropMarketId] = useState<string | null>(null)
  const [selection, setSelection] = useState<'over' | 'under'>('over')
  const [stake, setStake] = useState('')
  const [customStakes, setCustomStakes] = useState(false)
  const [opponentStake, setOpponentStake] = useState('')
  const [message, setMessage] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [seasonRes, weekRes] = await Promise.all([seasons.getCurrent(), weeks.getCurrent()])
      const seasonId = seasonRes.data?.id ?? null
      const wId = weekRes.data?.id ?? null
      setWeekId(wId)
      setWeekNumber(weekRes.data?.week_number ?? null)
      setSeasonId(seasonId)

      const fetches: PromiseLike<any>[] = []
      let playerRows: any[] = []
      let ledgerRows: any[] = []
      let gameRows: any[] = []
      let marketRows: any[] = []

      fetches.push(playersDb.listActive().then(({ data }) => { playerRows = data ?? [] }))
      if (playerId && seasonId) {
        fetches.push(pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerRows = data ?? [] }))
        fetches.push(pvpChallenges.projectedLine(playerId, seasonId).then(({ data }) => { setMyLine(data != null ? Number(data) : null) }))
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

      // Rematch prefill: inherit type + opponent and carry the prior stakes from
      // the viewer's perspective (their own side → STAKE, the other side →
      // opponent's stake). Reveal the custom-stakes field if they differed.
      if (route.params?.rematchOfId) {
        const { data } = await pvpChallenges.getById(route.params.rematchOfId)
        if (data) {
          const c = normalizeChallenge(data)
          setContractType(c.contractType as PvpContractType)
          setGameNumber(c.gameNumber ?? nums[0] ?? null)
          const iWasCreator = c.creatorId === playerId
          const myPrior = iWasCreator ? c.creatorStake : c.counterpartyStake
          const oppPrior = iWasCreator ? c.counterpartyStake : c.creatorStake
          setStake(String(myPrior))
          if (myPrior !== oppPrior) {
            setCustomStakes(true)
            setOpponentStake(String(oppPrior))
          }
          const other = c.creatorId === playerId ? c.counterpartyId : c.creatorId
          if (other) setOpponentId(other)
          if (c.contractType === 'prop_duel' && c.propMarketId) setPropMarketId(c.propMarketId)
          if (c.contractType === 'custom') {
            setCustomTitle(c.customTitle ?? '')
            setCustomDescription(c.customDescription ?? '')
          }
          if (c.contractType === 'head_to_head') {
            // Carry the prior handicaps from the viewer's perspective.
            const myHc = iWasCreator ? c.creatorHandicap : c.counterpartyHandicap
            const oppHc = iWasCreator ? c.counterpartyHandicap : c.creatorHandicap
            if (myHc) setMyHandicap(String(myHc))
            if (oppHc) setOpponentHandicap(String(oppHc))
          }
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

  // Preview the named opponent's line-to-beat for a Line Duel. Cleared for the
  // open board (the taker's line is set when they engage) or non-line contracts.
  useEffect(() => {
    if (contractType !== 'line_duel' || openBoard || !opponentId || !seasonId) {
      setOpponentLine(null)
      return
    }
    let active = true
    pvpChallenges.projectedLine(opponentId, seasonId).then(({ data }) => {
      if (active) setOpponentLine(data != null ? Number(data) : null)
    })
    return () => { active = false }
  }, [contractType, openBoard, opponentId, seasonId])

  const stakeNum = parseInt(stake, 10)
  // Opponent's stake mirrors yours unless custom stakes are toggled on.
  const oppStakeNum = customStakes ? parseInt(opponentStake, 10) : stakeNum
  const validMyStake = !isNaN(stakeNum) && stakeNum >= PVP_MIN_STAKE && stakeNum <= balance
  const validOppStake = !isNaN(oppStakeNum) && oppStakeNum >= PVP_MIN_STAKE
  const validStake = validMyStake && validOppStake
  const opponentName = useMemo(
    () => opponents.find(o => o.id === opponentId)?.name ?? null,
    [opponents, opponentId],
  )
  const selectedProp = useMemo(
    () => propMarkets.find(m => m.marketId === propMarketId) ?? null,
    [propMarkets, propMarketId],
  )

  const isProp = contractType === 'prop_duel'
  const isCustom = contractType === 'custom'
  const isHeadToHead = contractType === 'head_to_head'
  // Parse the signed handicap inputs (blank or "-" alone → 0).
  const myHandicapNum = parseInt(myHandicap, 10) || 0
  const oppHandicapNum = parseInt(opponentHandicap, 10) || 0

  function validate(): string | null {
    if (!weekId) return 'No active week to challenge in'
    if (!openBoard && !opponentId) return 'Pick an opponent or post to the open board'
    if (isNaN(stakeNum) || stakeNum < PVP_MIN_STAKE) return `Minimum stake is ${PVP_MIN_STAKE} pins`
    if (stakeNum > balance) return 'Stake exceeds your balance'
    if (customStakes && (isNaN(oppStakeNum) || oppStakeNum < PVP_MIN_STAKE)) {
      return `Opponent's stake must be at least ${PVP_MIN_STAKE} pins`
    }
    if (isCustom) {
      if (!customTitle.trim()) return 'Give your custom challenge a title'
      if (!customDescription.trim()) return 'Describe the win condition'
    } else if (isProp) {
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
        gameNumber: isProp || isCustom ? null : gameNumber,
        creatorStake: stakeNum,
        counterpartyStake: oppStakeNum,
        propMarketId: isProp ? propMarketId : null,
        creatorSelection: isProp ? selection : null,
        message: message.trim() || null,
        customTitle: isCustom ? customTitle.trim() : null,
        customDescription: isCustom ? customDescription.trim() : null,
        // The viewer is always the creator here: "your" → creator, opponent → counterparty.
        creatorHandicap: isHeadToHead ? myHandicapNum : 0,
        counterpartyHandicap: isHeadToHead ? oppHandicapNum : 0,
      }
      const { error } = await pvpChallenges.create(args)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Challenge sent', 'success')
      // Return to the list that owns this contract — the Challenge Board for an open
      // post, otherwise the PvP inbox. Both are already in the stack, so this pops
      // back; the list's focus reload surfaces the new challenge.
      navigation.navigate(openBoard ? 'PvPBoard' : 'PvP')
    } catch {
      showToast('Failed to create challenge', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingView label="Loading…" delayed />

  const pot = validStake ? stakeNum + oppStakeNum : 0

  return (
    <ScreenContainer
      title="New Challenge"
      subtitle="Set your terms"
      onRefresh={load}
      keyboardShouldPersistTaps="handled"
      contentStyle={{ paddingBottom: 60 }}
      overlay={<Toast />}
    >
        {/* Opponent */}
        <Text style={styles.label}>OPPONENT</Text>
        <View style={styles.opponentRow}>
          <Button
            selectable
            value={opponentName}
            placeholder="Select player…"
            onPress={() => setPickerOpen(true)}
            disabled={openBoard}
            fullWidth
          />
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
        <Text style={styles.contractRule}>{CONTRACT_TYPE_RULE[contractType]}</Text>

        {/* Lines to beat (Line Duel only) — frozen onto the contract at create */}
        {contractType === 'line_duel' && (
          <LineDuelLines
            sides={[
              { name: 'Your line', value: myLine != null ? myLine.toFixed(1) : '—' },
              {
                name: opponentName ?? 'Opponent',
                value: openBoard ? 'Set when taken' : opponentLine != null ? opponentLine.toFixed(1) : '—',
              },
            ]}
          />
        )}

        {/* Handicaps (Head-to-Head only) — signed pins added to each score at settle */}
        {isHeadToHead && (
          <>
            <View style={styles.handicapRow}>
              <View style={styles.handicapCell}>
                <Text style={styles.label}>YOUR HANDICAP</Text>
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
                <Text style={styles.label}>{(opponentName ?? 'OPPONENT').toUpperCase()}'S HANDICAP</Text>
                <TextInput
                  style={styles.input}
                  value={opponentHandicap}
                  onChangeText={v => setOpponentHandicap(sanitizeHandicap(v))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="0"
                  placeholderTextColor={colors.muted2}
                  maxLength={4}
                />
              </View>
            </View>
            <Text style={styles.helpText}>Pins added to a player's score (negative subtracts). 0 = no handicap.</Text>
            <LineDuelLines
              label="HANDICAPS"
              sides={[
                { name: 'You', value: formatHandicap(myHandicapNum) },
                { name: opponentName ?? 'Opponent', value: formatHandicap(oppHandicapNum) },
              ]}
            />
          </>
        )}

        {/* Scope */}
        <Text style={styles.label}>WEEK {weekNumber ?? '—'} · SCOPE</Text>
        {isCustom ? (
          <View>
            <TextInput
              style={styles.input}
              value={customTitle}
              onChangeText={setCustomTitle}
              placeholder="Challenge title…"
              placeholderTextColor={colors.muted2}
              maxLength={80}
            />
            <Text style={[styles.label, { marginTop: 14 }]}>WIN CONDITION</Text>
            <TextInput
              style={[styles.input, styles.descriptionInput]}
              value={customDescription}
              onChangeText={setCustomDescription}
              placeholder="Describe exactly how this challenge is won…"
              placeholderTextColor={colors.muted2}
              multiline
              maxLength={500}
            />
            <View style={styles.warnCard}>
              <Text style={styles.warnText}>
                Write the win condition clearly — an Admin settles this contract by hand based on exactly what you describe here.
              </Text>
              <Text style={[styles.warnText, { marginTop: 14 }]}>
                Be sure to specify if the outcome is game-specific (Game 1 or Game 2), or if it covers the entire week.
              </Text>
              <Text style={[styles.warnText, { marginTop: 14 }]}>
                Admins will VOID all contracts that incentivise tanking behavior with EXTREME prejudice, and reserve the right to VOID any contracts with unclear or unenforceable conditions.
              </Text>
            </View>
          </View>
        ) : isProp ? (
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
          <GamePicker games={gameNumbers} value={gameNumber} onChange={setGameNumber} />
        )}

        {/* Stake */}
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
        <Text style={styles.helpText}>Balance: {formatPins(balance)} pins</Text>

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
            <Text style={styles.helpText}>
              Each side stakes a different amount — winner still takes the whole pot. The opponent's
              balance is checked when they accept.
            </Text>
          </>
        )}

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
          {contractType === 'line_duel' && (
            <>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Your line</Text>
                <Text style={styles.confirmValue}>{myLine != null ? myLine.toFixed(1) : '—'}</Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>{opponentName ?? "Opponent's"} line</Text>
                <Text style={styles.confirmValue}>
                  {openBoard ? 'Set when taken' : opponentLine != null ? opponentLine.toFixed(1) : '—'}
                </Text>
              </View>
            </>
          )}
          {isHeadToHead && (
            <>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Your handicap</Text>
                <Text style={styles.confirmValue}>{formatHandicap(myHandicapNum)}</Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>{opponentName ?? "Opponent's"} handicap</Text>
                <Text style={styles.confirmValue}>{formatHandicap(oppHandicapNum)}</Text>
              </View>
            </>
          )}
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Your stake</Text>
            <Text style={styles.confirmValue}>{validMyStake ? formatPins(stakeNum) : '—'} pins</Text>
          </View>
          {customStakes && (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Opponent's stake</Text>
              <Text style={styles.confirmValue}>{validOppStake ? formatPins(oppStakeNum) : '—'} pins</Text>
            </View>
          )}
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Total pot</Text>
            <Text style={styles.confirmValueAccent}>{formatPins(pot)} pins</Text>
          </View>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Winner's payout</Text>
            <Text style={styles.confirmValueAccent}>{formatPins(pot)} pins</Text>
          </View>
          <Text style={styles.confirmRule}>{CONTRACT_TYPE_RULE[contractType]}</Text>
          <Text style={styles.confirmNote}>
            Winner takes the whole pot — no house cut.
          </Text>
        </View>

        <Button
          label={openBoard ? 'Post Challenge' : 'Send Challenge'}
          size="lg"
          onPress={submit}
          disabled={submitting || !validStake}
          style={styles.submitBtn}
        />

        {/* Modal-based picker: renders in the native overlay layer, so mounting
            inside the ScrollView children is visually identical. */}
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
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
    marginTop: 18,
    marginBottom: 8,
  },
  toggle: { justifyContent: 'flex-start' },
  contractRule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 10 },

  handicapRow: { flexDirection: 'row', gap: 8 },
  handicapCell: { flex: 1 },

  stakeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stakeLabel: { flex: 1 },
  customToggle: {
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  customToggleOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  customToggleText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  customToggleTextOn: { color: colors.accent },

  opponentRow: { flexDirection: 'row', gap: 8 },
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
  descriptionInput: { fontFamily: fonts.barlow, fontSize: 15, minHeight: 90, textAlignVertical: 'top', marginTop: 8 },
  helpText: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },

  warnCard: {
    backgroundColor: 'rgba(244,208,63,0.10)',
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(244,208,63,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 12,
  },
  warnText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.gold, lineHeight: 18 },

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

  submitBtn: { marginTop: 20 },
})
