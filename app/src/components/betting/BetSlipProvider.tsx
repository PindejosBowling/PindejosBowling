import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { View, StyleSheet, Alert, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BetSlip, { type SlipPick, type SlipSpecial, type SlipCombo, type SlipSubmit } from './BetSlip'
import {
  normalizeMarket,
  isSelectionHiddenInUI,
  type BetView,
  type SelectionView,
} from '../../hooks/usePinsinoData'
import { computeBalance } from '../../utils/ledger'
import { fmtOdds } from '../../utils/bets'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import {
  bets,
  betMarkets,
  seasons,
  inventoryItems,
  pinLedger,
} from '../../utils/supabase/db'

// Default RN bottom-tab content height (excludes the bottom safe-area inset,
// which the tab bar adds on top). The collapsed slip bar is offset above the
// tab bar by this + insets.bottom, so a globally-mounted overlay sits exactly
// where the old in-screen bar did (12px above the tab bar).
const TAB_BAR_HEIGHT = 49

interface BetSlipContextValue {
  // Whether placing is possible for this viewer (a logged-in player on the LIVE
  // season). Gates the "Place this bet" CTA in BetDetailModal.
  enabled: boolean
  // Current staged contents — read by the board to highlight selected cells.
  slipPicks: SlipPick[]
  slipSpecials: SlipSpecial[]
  slipCombos: SlipCombo[]
  // Staging (board taps hand in a fully-built pick; specials hand in a bundle;
  // the combo composer hands in a market-less combo spec).
  stagePick: (pick: SlipPick) => void
  // Live re-stage: value edits on an already-staged market patch its pick in
  // place (line/odds/selectionId) — the slip chip and ticket re-render live.
  updateSlipPick: (marketId: string, patch: Partial<SlipPick>) => void
  removeSlipPick: (marketId: string) => void
  stageSpecial: (special: SlipSpecial) => void
  removeSlipSpecial: (key: string) => void
  stageCombo: (combo: SlipCombo) => void
  removeSlipCombo: (key: string) => void
  clearSlip: () => void
  openSlip: () => void
  // Presentational only: hide the collapsed slip bar while the Sportsbook's
  // combine-mode BuilderBar occupies its footprint. Staging/placement are
  // unaffected; the screen restores it on every combine-mode exit.
  setSlipBarHidden: (hidden: boolean) => void
  // Copy an existing active bet into the slip, re-resolved against current live
  // markets, then raise the placement sheet. No-op/toast when not copyable.
  copyBet: (bet: BetView) => Promise<void>
  // Ghost inventory ids (oldest first) — the Sportsbook haunt CTA spends [0].
  ghosts: string[]
  reloadInventory: () => Promise<void>
  // Register the host screen's data refresh so a placement updates its board.
  registerReload: (fn: (() => void) | null) => void
}

const NOOP = () => {}

const BetSlipContext = createContext<BetSlipContextValue>({
  enabled: false,
  slipPicks: [],
  slipSpecials: [],
  slipCombos: [],
  stagePick: NOOP,
  updateSlipPick: NOOP,
  removeSlipPick: NOOP,
  stageSpecial: NOOP,
  removeSlipSpecial: NOOP,
  stageCombo: NOOP,
  removeSlipCombo: NOOP,
  clearSlip: NOOP,
  openSlip: NOOP,
  setSlipBarHidden: NOOP,
  copyBet: async () => {},
  ghosts: [],
  reloadInventory: async () => {},
  registerReload: NOOP,
})

export function useBetSlip() {
  return useContext(BetSlipContext)
}

// Register a data-refresh callback that runs after a placement, so the calling
// screen's board updates. Clears on unmount. Default is a no-op.
export function useBetSlipReload(reload: () => void) {
  const { registerReload } = useBetSlip()
  useEffect(() => {
    registerReload(reload)
    return () => registerReload(null)
  }, [registerReload, reload])
}

// App-level owner of the bet slip: staged picks/specials, the item inventory +
// balance the placement sheet needs, the place_house_bet loop, and the "copy an
// existing bet" flow. Mounted once above the tab navigator so the slip can be
// raised from BetDetailModal on ANY screen (Sportsbook, Market Moves, ledgers,
// Admin) without navigating back to the Sportsbook. Renders one BetSlip overlay
// whenever something is staged; its BottomSheet is an RN Modal, so the expanded
// sheet positions itself over whatever screen is showing.
export function BetSlipProvider({ children }: { children: ReactNode }) {
  const playerId = useAuthStore(s => s.playerId)
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const showToast = useUiStore(s => s.showToast)
  const insets = useSafeAreaInsets()

  // Placing requires a logged-in player viewing the LIVE season (a past-season
  // view is read-only). Mirrors SportsbookScreen's readOnly gating for the slip.
  const enabled = !!playerId && !pinsinoViewSeasonId

  const [slipPicks, setSlipPicks] = useState<SlipPick[]>([])
  const [slipSpecials, setSlipSpecials] = useState<SlipSpecial[]>([])
  const [slipCombos, setSlipCombos] = useState<SlipCombo[]>([])
  const [slipOpen, setSlipOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  // Presentational: the Sportsbook hides the collapsed bar while its
  // combine-mode BuilderBar occupies the same footprint.
  const [slipBarHidden, setSlipBarHidden] = useState(false)

  const [balance, setBalance] = useState(0)
  const [tickets, setTickets] = useState<string[]>([])
  const [crutches, setCrutches] = useState<string[]>([])
  const [boosts, setBoosts] = useState<string[]>([])
  const [boostPct, setBoostPct] = useState(1)
  const [ghosts, setGhosts] = useState<string[]>([])

  const hostReload = useRef<(() => void) | null>(null)
  const registerReload = useCallback((fn: (() => void) | null) => {
    hostReload.current = fn
  }, [])

  // Load the balance + attachable-item inventory the placement sheet needs.
  // Live-season only (items don't exist in a past-season view); mirrors the old
  // SportsbookScreen reloadTickets + ledger-balance logic in one place.
  const refreshContext = useCallback(async () => {
    if (!playerId || pinsinoViewSeasonId) {
      setBalance(0); setTickets([]); setCrutches([]); setBoosts([]); setBoostPct(1); setGhosts([])
      return
    }
    const { data: season } = await seasons.getCurrent()
    if (!season) {
      setBalance(0); setTickets([]); setCrutches([]); setBoosts([]); setBoostPct(1); setGhosts([])
      return
    }
    const [{ data: ledgerData }, { data: invData }] = await Promise.all([
      pinLedger.listByPlayerSeason(playerId, season.id),
      inventoryItems.listByPlayerSeason(playerId, season.id),
    ])
    setBalance(computeBalance((ledgerData ?? []) as any))
    const unconsumed = (invData ?? [])
      .filter((i: any) => i.consumed_at == null)
      .sort((a: any, b: any) => a.granted_at.localeCompare(b.granted_at))
    const attachable = unconsumed.filter((i: any) => i.item_catalog?.activation_mode === 'attach_to_bet')
    setTickets(attachable.filter((i: any) => i.item_catalog?.effect_type === 'bet_insurance').map((i: any) => i.id))
    setCrutches(attachable.filter((i: any) => i.item_catalog?.effect_type === 'parlay_crutch').map((i: any) => i.id))
    const boostRows = attachable.filter((i: any) => i.item_catalog?.effect_type === 'odds_boost')
    setBoosts(boostRows.map((i: any) => i.id))
    setBoostPct(boostRows.length ? Number((boostRows[0].item_catalog?.effect_params as any)?.boost_pct ?? 1) : 1)
    setGhosts(unconsumed.filter((i: any) => i.item_catalog?.effect_type === 'haunt').map((i: any) => i.id))
  }, [playerId, pinsinoViewSeasonId])

  // Lazy load: fetch balance + inventory the first time the slip fills, and
  // refresh whenever it empties→fills again. Keeps idle cost ~zero (nothing
  // fetches until a pick is staged from the board or a bet is copied).
  const count = slipPicks.length + slipSpecials.length + slipCombos.length
  const wasEmpty = useRef(true)
  useEffect(() => {
    if (count > 0 && wasEmpty.current) {
      wasEmpty.current = false
      refreshContext()
    } else if (count === 0) {
      wasEmpty.current = true
    }
  }, [count, refreshContext])

  const stagePick = useCallback((pick: SlipPick) => {
    setSlipPicks(prev => {
      const existing = prev.find(p => p.marketId === pick.marketId)
      // Re-staging the same VALUE removes it; a different value on that market
      // replaces it (picks are line-shaped — the value IS the identity).
      if (existing && existing.line === pick.line) {
        return prev.filter(p => p.marketId !== pick.marketId)
      }
      return [...prev.filter(p => p.marketId !== pick.marketId), pick]
    })
  }, [])

  const updateSlipPick = useCallback((marketId: string, patch: Partial<SlipPick>) => {
    setSlipPicks(prev => prev.map(p => (p.marketId === marketId ? { ...p, ...patch } : p)))
  }, [])

  const removeSlipPick = useCallback((marketId: string) => {
    setSlipPicks(prev => prev.filter(p => p.marketId !== marketId))
  }, [])

  const stageSpecial = useCallback((special: SlipSpecial) => {
    setSlipSpecials(prev =>
      prev.some(s => s.key === special.key)
        ? prev.filter(s => s.key !== special.key)
        : [...prev, special]
    )
  }, [])

  const removeSlipSpecial = useCallback((key: string) => {
    setSlipSpecials(prev => prev.filter(s => s.key !== key))
  }, [])

  // Staging the identical combo again (same canonical key) toggles it out —
  // matching how re-staging the same pick removes it from the slip.
  const stageCombo = useCallback((combo: SlipCombo) => {
    setSlipCombos(prev =>
      prev.some(c => c.key === combo.key)
        ? prev.filter(c => c.key !== combo.key)
        : [...prev, combo]
    )
  }, [])

  const removeSlipCombo = useCallback((key: string) => {
    setSlipCombos(prev => prev.filter(c => c.key !== key))
  }, [])

  const clearSlip = useCallback(() => {
    setSlipPicks([])
    setSlipSpecials([])
    setSlipCombos([])
    setSlipOpen(false)
  }, [])

  const openSlip = useCallback(() => setSlipOpen(true), [])

  // An emptied slip closes the sheet state too. Without this, removing the
  // last item from inside the open sheet unmounts the overlay with slipOpen
  // stranded true — and the next staged pick would remount it sheet-open
  // (staging must only ever populate the bar, never raise the sheet).
  useEffect(() => {
    if (count === 0) setSlipOpen(false)
  }, [count])

  // Re-resolve an existing active bet's legs against the CURRENT live markets
  // (odds/lines may have moved since placement) and stage it, then raise the
  // sheet. A Special (custom_line_id set) re-stages as its tagged bundle — the
  // RPC only requires the line to be live and re-resolves selections client-side
  // like any parlay, so an under leg (which specials may carry) stays valid; a
  // plain single/parlay re-stages as individual picks (under legs never copy).
  const copyBet = useCallback(async (bet: BetView) => {
    if (!enabled) return
    if (bet.status !== 'pending') { showToast('Only active bets can be copied', 'error'); return }
    const isSpecial = bet.customLineId != null
    const marketIds = Array.from(new Set(bet.legs.map(l => l.marketId)))
    if (marketIds.length === 0) { showToast("This bet can't be copied", 'error'); return }

    const { data, error } = await betMarkets.getByIds(marketIds)
    const staleMsg = 'This bet can no longer be copied — the line has closed or moved.'
    if (error) { showToast("Couldn't load the current line", 'error'); return }
    const byMarket = new Map((data ?? []).map(normalizeMarket).map(l => [l.marketId, l]))

    const resolved: { line: ReturnType<typeof normalizeMarket>; sel: SelectionView }[] = []
    for (const leg of bet.legs) {
      const line = byMarket.get(leg.marketId)
      // Missing = settled/void since placement; inProgress = closed for betting.
      if (!line || line.inProgress) { showToast(staleMsg, 'error'); return }
      const sel = line.selections.find(s => s.selectionId === leg.selectionId)
      if (!sel) { showToast(staleMsg, 'error'); return }
      // The hide-the-under policy is a per-pick board rule; a Special bundles its
      // legs (RPC-validated as a unit), so it may legitimately include an under.
      if (!isSpecial && isSelectionHiddenInUI(line, sel)) { showToast(staleMsg, 'error'); return }
      resolved.push({ line, sel })
    }

    await refreshContext()
    setSlipCombos([])
    if (isSpecial) {
      setSlipPicks([])
      setSlipSpecials([{
        key: bet.customLineId!,
        lineId: bet.customLineId!,
        title: bet.customLineTitle ?? 'Special',
        category: bet.customLineCategory === 'special' ? 'special' : 'default',
        summary: resolved.map(({ line, sel }) => `${line.subjectName} ${sel.label.toUpperCase()}`).join('  ·  '),
        selectionIds: resolved.map(({ sel }) => sel.selectionId),
        combinedOdds: resolved.reduce((p, { sel }) => p * (sel.odds ?? 2), 1),
        multiLeg: resolved.length > 1,
      }])
    } else {
      setSlipSpecials([])
      setSlipPicks(resolved.map(({ line, sel }) => ({
        selectionId: sel.selectionId,
        selectionKey: sel.key,
        selectionLabel: sel.label,
        marketId: line.marketId,
        subjectName: line.subjectName,
        subjectPlayerId: line.subjectPlayerId,
        marketType: line.marketType,
        gameNumber: line.gameNumber,
        line: sel.line ?? line.line,
        statKey: line.statKey,
        odds: sel.odds ?? 2,
      })))
    }
    setSlipOpen(true)
  }, [enabled, showToast, refreshContext])

  // The placement rejected because a quote drifted beyond quote_tolerance —
  // 'ODDS_MOVED|<market_id>|<quoted>|<fresh>' (bet_mint_rung_internal).
  const parseOddsMoved = (msg: string | undefined) => {
    const m = /ODDS_MOVED\|([0-9a-f-]{36})\|([\d.]+)\|([\d.]+)/.exec(msg ?? '')
    return m ? { marketId: m[1], quoted: Number(m[2]), fresh: Number(m[3]) } : null
  }

  // "Odds moved ×3.40 → ×3.15 — place at the new price?" RN Alert on native;
  // window.confirm on web (react-native-web's Alert renders nothing).
  const confirmOddsMoved = (quoted: number, fresh: number) =>
    new Promise<boolean>(resolve => {
      const msg = `The price moved ${fmtOdds(quoted)} → ${fmtOdds(fresh)} while you were betting. Place at the new price?`
      if (Platform.OS === 'web') {
        resolve(typeof window !== 'undefined' && window.confirm(msg))
        return
      }
      Alert.alert('Odds moved', msg, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Place bet', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) })
    })

  // Places the whole slip: at most one parlay (the combined picks + combo
  // specs) plus each standalone single (singles-mode picks/combos + every
  // special, which carries its lineId tag). Regular picks are LINE-shaped —
  // {market_id, line, quoted_odds} through place_bet_at_lines (the server
  // prices the value authoritatively and mints the rung on demand); combo
  // entries route through compose_combo_bet with any parlayed picks riding as
  // extra_picks (still ONE bet); specials keep the selection-resolved
  // bets.place path. An ODDS_MOVED rejection patches the drifted price and
  // asks the bettor to confirm the fresh one (bounded retries). Items attach
  // to the sole bet only (BetSlip gates the flags). Sequential; reports
  // partial placement on failure.
  const placeSlip = useCallback(async ({ parlay, singles, insure, crutch, boost }: SlipSubmit) => {
    if (!enabled) return
    const total = (parlay?.stake ?? 0) + singles.reduce((s, e) => s + e.stake, 0)
    if (parlay && parlay.stake < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (singles.some(e => e.stake < 10)) { showToast('Minimum stake is 10 pins', 'error'); return }
    if (total > balance) { showToast('Total stake exceeds your balance', 'error'); return }

    const comboByKey = new Map(slipCombos.map(c => [c.key, c]))
    const pickByMarket = new Map(slipPicks.map(p => [p.marketId, p]))
    const itemArgs = (): [string | undefined, string | undefined, string | undefined] => [
      insure ? tickets[0] : undefined, crutch ? crutches[0] : undefined, boost ? boosts[0] : undefined,
    ]

    // One bet (parlay or single): resolve picks/combos to line-shaped legs and
    // run the placement, re-confirming through bounded ODDS_MOVED rounds.
    // Returns null on success, else the error message to toast.
    const placeOne = async (
      pickMarketIds: string[],
      comboKeys: string[],
      stake: number,
      items: [string | undefined, string | undefined, string | undefined],
    ): Promise<string | null> => {
      const legs: { marketId: string; line: number; quotedOdds: number }[] = []
      for (const id of pickMarketIds) {
        const p = pickByMarket.get(id)
        if (!p || p.line == null) return 'A staged pick went stale — re-add it from the board'
        legs.push({ marketId: p.marketId, line: p.line, quotedOdds: p.odds })
      }
      const specs = comboKeys
        .map(k => comboByKey.get(k))
        .filter((c): c is SlipCombo => !!c)
        .map(c => ({ ...c }))

      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = specs.length > 0
          ? await bets.composeCombo(
              specs[0].weekId,
              specs.map(c => ({
                memberIds: c.memberIds, stat: c.stat, scope: c.scope,
                gameNumber: c.gameNumber, line: c.line, quotedOdds: c.odds,
              })),
              stake, undefined, ...items,
              legs.length > 0 ? legs : undefined)
          : await bets.placeAtLines(legs, stake, ...items)
        if (!error) return null

        const moved = parseOddsMoved(error.message)
        if (!moved) return error.message

        // Patch the drifted leg (market match) or, failing that, the combo
        // spec carrying the rejected quote (a dedup-mint reports the combo's
        // market id, which the slip doesn't know pre-compose).
        const leg = legs.find(l => l.marketId === moved.marketId)
        const spec = leg ? undefined : (specs.find(c => c.odds === moved.quoted) ?? specs[0])
        if (leg) leg.quotedOdds = moved.fresh
        else if (spec) spec.odds = moved.fresh
        else return error.message

        // Reflect reality on the staged slip either way (cancel leaves the
        // ticket showing the price the book will actually honor).
        if (leg) updateSlipPick(moved.marketId, { odds: moved.fresh })
        else if (spec) setSlipCombos(prev => prev.map(c => (c.key === spec.key ? { ...c, odds: moved.fresh } : c)))

        const ok = await confirmOddsMoved(moved.quoted, moved.fresh)
        if (!ok) return 'Bet not placed — the slip now shows the current price'
      }
      return 'The odds keep moving — try placing again'
    }

    setPlacing(true)
    let placed = 0
    const totalBets = (parlay ? 1 : 0) + singles.length
    try {
      if (parlay) {
        const err = await placeOne(parlay.pickMarketIds, parlay.comboKeys, parlay.stake, itemArgs())
        if (err) { showToast(err, 'error'); return }
        placed += 1
      }
      for (const e of singles) {
        // Specials stay selection-resolved (their bundle is RPC-validated as a
        // unit and may legitimately include an under).
        const err = e.lineId != null
          ? (await bets.place(e.selectionIds ?? [], e.stake, e.lineId, ...itemArgs())).error?.message ?? null
          : await placeOne(e.pickMarketIds ?? [], e.comboKey ? [e.comboKey] : [], e.stake, itemArgs())
        if (err) {
          showToast(placed > 0 ? `Placed ${placed} — then: ${err}` : err, 'error')
          return
        }
        placed += 1
      }
      showToast(totalBets > 1 ? `${placed} bets placed!` : (insure ? 'Bet placed — Golden Ticket attached!' : 'Bet placed!'), 'success')
      clearSlip()
    } catch {
      showToast('Failed to place bets', 'error')
    } finally {
      setPlacing(false)
      await refreshContext()
      hostReload.current?.()
    }
  }, [enabled, balance, slipPicks, slipCombos, tickets, crutches, boosts, showToast, clearSlip, refreshContext, updateSlipPick])

  const value = useMemo<BetSlipContextValue>(() => ({
    enabled,
    slipPicks,
    slipSpecials,
    slipCombos,
    stagePick,
    updateSlipPick,
    removeSlipPick,
    stageSpecial,
    removeSlipSpecial,
    stageCombo,
    removeSlipCombo,
    clearSlip,
    openSlip,
    setSlipBarHidden,
    copyBet,
    ghosts,
    reloadInventory: refreshContext,
    registerReload,
  }), [enabled, slipPicks, slipSpecials, slipCombos, stagePick, updateSlipPick, removeSlipPick, stageSpecial, removeSlipSpecial, stageCombo, removeSlipCombo, clearSlip, openSlip, copyBet, ghosts, refreshContext, registerReload])

  return (
    <BetSlipContext.Provider value={value}>
      {children}
      {/* Global slip overlay. box-none lets touches through everywhere except the
          bar itself; offset above the tab bar so the bar lands where the old
          in-screen bar did. The expanded sheet is an RN Modal (self-positioning).
          slipBarHidden yields the footprint to the combine-mode BuilderBar. */}
      {enabled && count > 0 && !slipBarHidden && (
        <View pointerEvents="box-none" style={[styles.overlay, { bottom: insets.bottom + TAB_BAR_HEIGHT }]}>
          <BetSlip
            picks={slipPicks}
            specials={slipSpecials}
            combos={slipCombos}
            open={slipOpen}
            onOpenChange={setSlipOpen}
            onRemovePick={removeSlipPick}
            onRemoveSpecial={removeSlipSpecial}
            onRemoveCombo={removeSlipCombo}
            onClear={clearSlip}
            balance={balance}
            placing={placing}
            ticketCount={tickets.length}
            crutchCount={crutches.length}
            boostCount={boosts.length}
            boostPct={boostPct}
            onPlace={placeSlip}
          />
        </View>
      )}
    </BetSlipContext.Provider>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
})
