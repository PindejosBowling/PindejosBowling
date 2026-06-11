import { useState, useCallback, useEffect } from 'react'
import { weeks, seasons, betMarkets, bets, pinLedger, loanLedger, loans, pvpChallenges, bountyPosts, teamSlots, customLines } from '../utils/supabase/db'

// One bettable side of a market (a single `bet_selections` row, flattened).
// Generic over market_type — over/under is the first consumer, but the shape
// carries any side (over/under, yes/no, a moneyline pick, …) so new market
// types reuse it without bespoke fields.
export interface SelectionView {
  selectionId: string
  key: string            // stable side key: 'over' | 'under' | 'yes' | a player id, …
  label: string          // display label ('Over', 'Under', …)
  line: number | null    // this side's total/handicap (the O/U number); null if n/a
  odds: number           // decimal odds (2.000 = even money)
}

// A flattened bettable market (one market + its selections). Generic over
// market_type so a single row component renders every line kind.
export interface LineView {
  marketId: string
  marketType: string         // 'over_under' | 'moneyline' | 'prop'
  title: string
  subjectPlayerId: string | null
  subjectName: string
  gameNumber: number | null
  line: number | null        // shared line when every selection shares one (O/U); else null
  // LaneTalk stat key (bet_markets.params.stat) for prop markets; null otherwise.
  statKey: string | null
  // Optional left-column metadata line, shown where O/U renders "LINE 142.5".
  // Lets lineless markets (moneyline → "MONEYLINE · vs Team 3") carry context.
  subtitle?: string
  selections: SelectionView[]
  // Game in progress: market closed for betting, still shown but not bettable.
  inProgress: boolean
}

// Anti-tanking: a player may never back the side that bets *against* their own
// performance (the `under` on their own O/U line). Encodes the market-type
// semantics in one place — new market types declare their "against the subject"
// side here.
export function selectionBetsAgainstSubject(marketType: string, selectionKey: string): boolean {
  if (marketType === 'over_under') return selectionKey === 'under'
  // Stat props share O/U shape: the under bets against the subject's night.
  if (marketType === 'prop') return selectionKey === 'under'
  return false
}

// Display labels for the LaneTalk stat-prop kinds (bet_markets.params.stat).
export const STAT_LABELS: Record<string, string> = {
  strikes: 'Strikes',
  spares: 'Spares',
  clean_pct: 'Clean %',
  first_ball_avg: 'First-Ball Avg',
}

// The pick button IS the line being agreed to. Every side offered on the board
// is an over (unders are UI-hidden — all bets are over by definition), so the
// button reads as the threshold itself: "142.5+" on a score line, "4.5+" on a
// stat prop. Lineless sides (moneyline "WIN") keep their label.
export function selectionButtonLabel(line: LineView, sel: SelectionView): string {
  const threshold = sel.line ?? line.line
  if (sel.key === 'over' && threshold != null) return `${threshold.toFixed(1)}+`
  return (sel.label || sel.key).toUpperCase()
}

// The line suffix placed-bet surfaces append after the pick ("OVER 4.5 STRIKES",
// "OVER 142.5"). One helper so every gate (BetRow, detail/settle modals, parlay
// slips) treats stat props and score O/U the same way.
export function betLineSuffix(marketType: string, line: number | null, statKey?: string | null): string {
  if (line == null) return ''
  if (marketType === 'over_under') return ` ${line.toFixed(1)}`
  if (marketType === 'prop') {
    const label = statKey ? STAT_LABELS[statKey] ?? statKey : null
    return ` ${line.toFixed(1)}${label ? ` ${label.toUpperCase()}` : ''}`
  }
  return ''
}

// The section a line is bucketed under on the Place Bets board. Per-game markets
// group by game number; markets with no game (season-long / futures) share one
// group. New market kinds slot in here without the screen knowing their shape.
export interface LineGroup {
  key: string        // stable grouping key (also the React key)
  label: string      // section header — "GAME 1", "SEASON", …
  sortOrder: number  // ascending display order (game order, season-long last)
}

export function lineGroup(line: LineView): LineGroup {
  if (line.gameNumber != null) {
    return { key: `game-${line.gameNumber}`, label: `GAME ${line.gameNumber}`, sortOrder: line.gameNumber }
  }
  // Night-scoped stat props (no single game, settled over the whole night)
  // lead the board, above the game groups (game numbers start at 1).
  if (line.marketType === 'prop') {
    return { key: 'weekly', label: 'WEEKLY', sortOrder: 0 }
  }
  // Season-long / futures markets (no game scope) collect at the end.
  return { key: 'season', label: 'SEASON', sortOrder: Number.MAX_SAFE_INTEGER }
}

// The line *category* within a group — one collapsible LineRowContainer. A single
// game can surface several categories (player over/unders, team totals, …), each
// independently collapsible; the label summarizes what's inside on the collapsed
// bar. Market-type aware so new line kinds name their own section.
export interface LineCategory {
  key: string
  label: string
  sortOrder: number
}

export function lineCategory(line: LineView): LineCategory {
  switch (line.marketType) {
    case 'moneyline':
      // Shown first within each game, above the player overs.
      return { key: 'moneyline', label: 'Moneylines', sortOrder: 0 }
    case 'over_under':
      // Only the "over" side is bettable in the UI (the "under" is hidden — see
      // SportsbookScreen / context/betting-line-board.md), so the section reads
      // "Player Overs" rather than "Player Over/Unders".
      return { key: 'player_ou', label: 'Player Overs', sortOrder: 1 }
    case 'prop':
      // LaneTalk stat lines: per-game strike/spare props share the score O/U's
      // "Player Overs" section (one collapsible menu per game); night-level
      // clean% / first-ball props get their own section under WEEKLY.
      return line.gameNumber != null
        ? { key: 'player_ou', label: 'Player Overs', sortOrder: 1 }
        : { key: 'night_props', label: 'Night Props', sortOrder: 0 }
    default:
      return { key: line.marketType, label: line.title || line.marketType, sortOrder: 99 }
  }
}

// Copy shown when a group's betting is closed (the market is in progress).
// Market-type aware so non-game markets read sensibly.
export function closedBettingNote(line: LineView): string {
  if (line.gameNumber != null) return 'The Pinsino does not take action on games in progress'
  return 'The Pinsino does not take action while this market is in progress'
}

// One resolved leg of a bet (a single backed selection).
export interface LegView {
  selectionId: string       // the backed bet_selections row (custom-line matching key)
  marketId: string          // the leg's market — settled independently (admin settle)
  marketType: string        // 'over_under' | 'moneyline' | … (gates line display)
  subjectName: string
  pick: string              // display label: 'Over' / 'Under' / a team name
  line: number              // the O/U line; meaningless (0) for lineless markets
  statKey: string | null    // LaneTalk stat key for prop legs (display suffix)
  gameNumber: number | null
  actualScore: number | null
  result: string | null     // won | lost | push | void | null (pending)
}

// A flattened O/U bet. Single bets carry one leg; a parlay carries N. The
// top-level pick/line/gameNumber/etc. mirror the first leg for single-bet
// rendering paths; multi-leg consumers read `legs` / `legCount`.
export interface BetView {
  id: string
  playerId: string
  bettorName: string
  stake: number
  status: string            // pending | won | lost | push | void | cancelled
  settledAt: string | null
  potentialPayout: number
  pick: string              // first leg's selection label ('Over' / a team name)
  line: number
  statKey: string | null    // first leg's LaneTalk stat key (prop display suffix)
  gameNumber: number | null
  subjectName: string
  marketId: string          // first leg's market
  marketType: string        // first leg's market_type (gates line display)
  marketStatus: string
  actualScore: number | null
  weekNumber: number | null
  seasonNumber: number | null
  legs: LegView[]
  legCount: number
  // Special branding. Primary source: the bets row's snapshot columns, stamped
  // by place_house_bet at placement (durable — survives line edits/deletion and
  // renders in historical surfaces like the ledger). Fallback for legacy
  // untagged bets: client-side selection matching against the current week's
  // resolved specials. Null = plain single/parlay.
  customLineTitle: string | null
  customLineDescription: string | null
  customLineCategory: string | null
}

// One row in the season pin-balance scoreboard (Titans of Pindustry).
export interface LeaderboardEntry {
  playerId: string
  name: string
  balance: number
  openAction: number    // at-risk escrow: pending bets + locked PvP + active bounties
  debt: number          // outstanding active-loan debt (≥ 0)
  netWorth: number      // balance + openAction − debt
  movement: 'up' | 'down' | 'same' | null
}

// Summary of the caller's own active loan, surfaced for the Pinsino hub.
export interface ActiveLoanSummary {
  loanId: string
  productName: string
  outstanding: number
}

// Collapse bet → legs → selections → markets into a flat row. A single O/U bet
// has one leg; a parlay has many (combined odds = Π of the legs' odds).
export function normalizeBet(b: any): BetView {
  const rawLegs: any[] = b.bet_legs ?? []
  const legs: LegView[] = rawLegs.map((leg: any) => {
    const sel = leg?.bet_selections
    const mkt = sel?.bet_markets
    return {
      selectionId: sel?.id ?? '',
      marketId: mkt?.id ?? '',
      marketType: mkt?.market_type ?? '',
      subjectName: mkt?.subject?.name ?? mkt?.title ?? '—',
      // Prefer the selection label (readable for every market type — a team name
      // for moneylines, whose `key` is a team uuid) over the raw key.
      pick: sel?.label ?? sel?.key ?? '',
      line: Number(leg?.line_at_placement ?? sel?.line ?? 0),
      statKey: mkt?.params?.stat ?? null,
      gameNumber: mkt?.game_number ?? null,
      actualScore: mkt?.result_value != null ? Number(mkt.result_value) : null,
      result: leg?.result ?? null,
    }
  })

  const firstLeg = rawLegs[0]
  const firstSel = firstLeg?.bet_selections
  const firstMkt = firstSel?.bet_markets
  return {
    id: b.id,
    playerId: b.player_id,
    bettorName: b.players?.name ?? '—',
    stake: b.stake,
    status: b.status,
    settledAt: b.settled_at,
    potentialPayout: b.potential_payout,
    pick: firstSel?.label ?? firstSel?.key ?? '',
    line: Number(firstLeg?.line_at_placement ?? firstSel?.line ?? 0),
    statKey: firstMkt?.params?.stat ?? null,
    gameNumber: firstMkt?.game_number ?? null,
    subjectName: firstMkt?.subject?.name ?? firstMkt?.title ?? '—',
    marketId: firstMkt?.id ?? '',
    marketType: firstMkt?.market_type ?? '',
    marketStatus: firstMkt?.status ?? '',
    actualScore: firstMkt?.result_value != null ? Number(firstMkt.result_value) : null,
    weekNumber: firstMkt?.weeks?.week_number ?? null,
    seasonNumber: firstMkt?.weeks?.seasons?.number ?? null,
    legs,
    legCount: legs.length,
    customLineTitle: b.custom_line_title ?? null,
    customLineDescription: b.custom_line_description ?? null,
    customLineCategory: b.custom_line_category ?? null,
  }
}

function normalizeMarket(m: any): LineView {
  const selections: SelectionView[] = (m.bet_selections ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s: any) => ({
      selectionId: s.id,
      key: s.key,
      label: s.label ?? s.key ?? '—',
      line: s.line != null ? Number(s.line) : null,
      odds: Number(s.odds ?? 2),
    }))

  // A "shared line" exists when every selection carries the same line (the O/U
  // case) — surfaced once on the row. Markets whose sides differ (or have no
  // line) leave it null.
  const lineVals = selections.map(s => s.line).filter((v): v is number => v != null)
  const sharedLine =
    lineVals.length > 0 && lineVals.every(v => v === lineVals[0]) ? lineVals[0] : null

  // Stat props carry their kind in params.stat; the subtitle names the stat
  // (the threshold itself lives in the pick button — selectionButtonLabel).
  const statKey: string | null = m.market_type === 'prop' ? m.params?.stat ?? null : null
  const statLabel = statKey ? STAT_LABELS[statKey] ?? statKey : null

  return {
    marketId: m.id,
    marketType: m.market_type,
    title: m.title ?? '',
    subjectPlayerId: m.subject_player_id ?? null,
    // O/U markets name a player (subject); moneylines name a matchup via the
    // market title (subject is a game, so the player embed resolves null).
    subjectName: m.subject?.name ?? m.title ?? '—',
    gameNumber: m.game_number ?? null,
    line: sharedLine,
    statKey,
    subtitle: statLabel ? statLabel.toUpperCase() : undefined,
    selections,
    inProgress: m.status === 'closed',
  }
}

// Sportsbook social policy: a player may only bet their OWN team to win. Each
// moneyline market is reduced to the single selection for the player's week team
// (the opponent side is hidden). It's reshaped to mirror a player-prop row:
//   subject "Your Team" · subtitle "MONEYLINE · vs <opponent>" · button "WIN".
// The opponent's label is the metadata we keep before dropping that selection.
// Markets not involving the player's team (the other matchups) drop out — so a
// player sees exactly their own team's moneyline per game.
function toYourTeamMoneyline(line: LineView, myTeamId: string | null): LineView | null {
  const mine = myTeamId ? line.selections.find(s => s.key === myTeamId) : undefined
  if (!mine) return null
  const opponent = line.selections.find(s => s.key !== mine.key)
  return {
    ...line,
    subjectName: 'Your Team',
    subtitle: opponent ? `MONEYLINE · vs ${opponent.label}` : 'MONEYLINE',
    selections: [{ ...mine, label: 'Win' }],
  }
}

// ── Custom lines ("Specials") ────────────────────────────────────────────────
// Admin-authored templates bundling existing selections under a custom title
// (custom_lines table). Legs are abstract specs re-resolved against each week's
// auto-generated markets; taking a special places an ordinary single/parlay via
// bets.place. See context/betting-line-board.md.

// One leg spec as stored in custom_lines.legs jsonb. A moneyline leg means
// "the team containing player_id wins game_number" — anchored by player because
// team ids don't persist across weeks. Two fields are relative-by-null:
//  • player_id null = THE BETTOR (self-referential): the subject is whoever
//    takes the bet, so the line resolves per-viewer ("you beat your over").
//  • game_number null = EVERY GAME: the line materializes once per game that
//    week, each instance binding its null-game legs to that game ("the bettor
//    bowls their over in this game" → one offering in each game's group).
export interface CustomLegSpec {
  kind: 'over_under' | 'moneyline'
  player_id: string | null
  game_number: number | null
  pick: 'over' | 'under' | 'win'
}

// A leg spec resolved against this week's markets — carries everything the
// board, the take sheet, and the anti-tank check need.
export interface CustomLegView {
  selectionId: string
  marketId: string
  marketType: string
  subjectName: string          // O/U player name, or "<anchor>'s Team" for moneylines
  subjectPlayerId: string | null
  pick: string                 // display label: 'Over' / 'Under' / 'Win'
  selectionKey: string         // raw side key ('over' / 'under' / a team uuid)
  line: number | null
  gameNumber: number | null
  odds: number
  inProgress: boolean          // this leg's market is closed for betting
}

// A custom line resolved + available this week. gameNumber is derived: all legs
// in one game → that game's board group; mixed games → null (the week-wide
// SPECIALS section). inProgress mirrors the O/U board policy: shown but inert
// when any leg's market is closed for betting.
export interface CustomLineView {
  id: string        // unique per board instance (per-game instances: `<rowId>:g<N>`)
  lineId: string    // the raw custom_lines row id — what bets.place is tagged with
  title: string
  description: string
  category: 'default' | 'special'
  legs: CustomLegView[]
  selectionIds: string[]
  combinedOdds: number         // Π leg odds — what bets.place will pay (parlay math)
  gameNumber: number | null
  inProgress: boolean
}

// Anti-tanking mirror for specials: a player can't take a line containing a leg
// that bets against their own performance (an 'under' on their own O/U market).
// Display-layer guard only — place_house_bet enforces it server-side regardless.
export function customLineSelfTank(line: CustomLineView, playerId: string | null): boolean {
  if (!playerId) return false
  return line.legs.some(
    l => l.subjectPlayerId === playerId && selectionBetsAgainstSubject(l.marketType, l.selectionKey)
  )
}

// Resolve one custom_lines row against this week's markets, for one prospective
// taker. Fixed legs ignore the taker; self-referential legs (player_id null)
// substitute them as the subject — so a self line resolves differently per
// viewer, and is hidden from viewers it can't resolve for (not RSVP'd / not
// slotted). Returns null when the line is unavailable ("hidden" policy): any
// leg unresolvable (subject has no O/U market, anchor player not slotted, no
// such game) or two legs landing on the same market (a guaranteed-loser parlay
// place_house_bet would reject anyway). Resolution uses the RAW normalized
// markets — before the "Your Team" moneyline reshaping and the hide-the-under
// policy — because a special's legs may reference selections the viewer's own
// board hides.
function resolveCustomLine(
  raw: any,
  rawLines: LineView[],
  slotByPlayer: Map<string, { teamId: string; playerName: string }>,
  takerPlayerId: string | null,
  // The game this instance binds null-game ("every game") legs to. Null for
  // lines whose legs all carry fixed game numbers.
  instanceGame: number | null,
): CustomLineView | null {
  const specs: CustomLegSpec[] = Array.isArray(raw.legs) ? raw.legs : []
  if (specs.length === 0) return null

  const legs: CustomLegView[] = []
  const seenMarkets = new Set<string>()
  for (const spec of specs) {
    const subjectId = spec.player_id ?? takerPlayerId
    if (!subjectId) return null
    const legGame = spec.game_number ?? instanceGame
    if (legGame == null) return null
    let line: LineView | undefined
    let sel: SelectionView | undefined
    let subjectName = ''
    if (spec.kind === 'over_under') {
      line = rawLines.find(
        l => l.marketType === 'over_under' && l.subjectPlayerId === subjectId && l.gameNumber === legGame
      )
      sel = line?.selections.find(s => s.key === spec.pick)
      subjectName = spec.player_id == null ? 'You' : (line?.subjectName ?? '')
    } else {
      const slot = slotByPlayer.get(subjectId)
      if (!slot) return null
      line = rawLines.find(
        l => l.marketType === 'moneyline' && l.gameNumber === legGame && l.selections.some(s => s.key === slot.teamId)
      )
      sel = line?.selections.find(s => s.key === slot.teamId)
      subjectName = spec.player_id == null ? 'Your Team' : `${slot.playerName}'s Team`
    }
    if (!line || !sel) return null
    if (seenMarkets.has(line.marketId)) return null
    seenMarkets.add(line.marketId)
    legs.push({
      selectionId: sel.selectionId,
      marketId: line.marketId,
      marketType: line.marketType,
      subjectName,
      subjectPlayerId: line.subjectPlayerId,
      pick: spec.kind === 'moneyline' ? 'Win' : sel.label,
      selectionKey: sel.key,
      line: sel.line,
      gameNumber: line.gameNumber,
      odds: sel.odds,
      inProgress: line.inProgress,
    })
  }

  const firstGame = legs[0].gameNumber
  return {
    // Per-game instances of one row need distinct ids (React keys, modal state).
    id: instanceGame == null ? raw.id : `${raw.id}:g${instanceGame}`,
    lineId: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    category: raw.category === 'special' ? 'special' : 'default',
    legs,
    selectionIds: legs.map(l => l.selectionId),
    combinedOdds: legs.reduce((p, l) => p * l.odds, 1),
    gameNumber: legs.every(l => l.gameNumber === firstGame) ? firstGame : null,
    inProgress: legs.some(l => l.inProgress),
  }
}

export function usePinsinoData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [openLines, setOpenLines] = useState<LineView[]>([])
  const [myBets, setMyBets] = useState<BetView[]>([])
  // All bets placed by every player this week (for the "Active Bets" view)
  const [weekBets, setWeekBets] = useState<BetView[]>([])
  // All settled (won/lost/push) bets this season (for the "Settled Bets" view)
  const [settledBets, setSettledBets] = useState<BetView[]>([])
  // Season pin-balance scoreboard: active players sorted high → low.
  // `movement` = rank change vs. the prior week (null = no prior week / new entry).
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null)
  // Set of market ids the current player has already placed a bet on
  const [myBetMarketIds, setMyBetMarketIds] = useState<Set<string>>(new Set())
  // Admin custom lines ("Specials") resolved + available this week.
  const [customLineViews, setCustomLineViews] = useState<CustomLineView[]>([])
  // Caller's own loan figures (net-worth context near the balance card)
  const [debt, setDebt] = useState(0)
  // Caller's own at-risk pins escrowed across the Pinsino — pending sportsbook
  // bets + locked PvP contracts + active bounty entries. Already debited from
  // balance at placement, so this recovers the at-risk portion for the net calc.
  const [openAction, setOpenAction] = useState(0)
  const [activeLoan, setActiveLoan] = useState<ActiveLoanSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [weekRes, seasonRes] = await Promise.all([
        weeks.getCurrent(),
        seasons.getCurrent(),
      ])

      const weekId = weekRes.data?.id ?? null
      const seasonId = seasonRes.data?.id ?? null
      setCurrentWeekId(weekId)
      setCurrentSeasonId(seasonId)

      const fetches: PromiseLike<any>[] = []

      // Open O/U + moneyline + stat-prop markets + all bets for this week
      let marketsData: any[] = []
      let moneylineData: any[] = []
      let propData: any[] = []
      let weekBetsData: any[] = []
      // The player's team for this week — drives "Your Team" on the moneyline board.
      let myTeamId: string | null = null
      if (weekId && playerId) {
        fetches.push(
          teamSlots.getTeamForPlayerWeek(playerId, weekId).then(({ data }) => {
            myTeamId = data?.team_id ?? null
          })
        )
      }
      // Active custom lines + the week's full roster (player → team mapping for
      // resolving moneyline anchor legs of any player, not just the caller).
      let customLinesData: any[] = []
      let weekSlotsData: any[] = []
      if (weekId) {
        fetches.push(
          betMarkets.listActiveOUByWeek(weekId).then(({ data }) => {
            marketsData = data ?? []
          }),
          betMarkets.listActiveMoneylineByWeek(weekId).then(({ data }) => {
            moneylineData = data ?? []
          }),
          betMarkets.listActivePropByWeek(weekId).then(({ data }) => {
            propData = data ?? []
          }),
          bets.listByWeek(weekId).then(({ data }) => {
            weekBetsData = data ?? []
          }),
          customLines.listActive().then(({ data }) => {
            customLinesData = data ?? []
          }),
          teamSlots.listByWeek(weekId).then(({ data }) => {
            weekSlotsData = data ?? []
          })
        )
      }

      // Season-wide ledger for the pin-balance scoreboard + settled bets history
      let seasonLedger: any[] = []
      let settledBetsData: any[] = []
      // Per-player active-loan debt (sum of loan_ledger rows on active loans)
      let seasonDebt: any[] = []
      // Season-wide escrowed "open action" sources for the leaderboard's net-worth:
      // locked PvP contracts + all bounties (active hunter stakes summed per player).
      let seasonPvpData: any[] = []
      let seasonBountyData: any[] = []
      if (seasonId) {
        fetches.push(
          pinLedger.listBySeasonForLeaderboard(seasonId).then(({ data }) => {
            seasonLedger = data ?? []
          }),
          bets.listSettledBySeason(seasonId).then(({ data }) => {
            settledBetsData = data ?? []
          }),
          loanLedger.listActiveBySeason(seasonId).then(({ data }) => {
            seasonDebt = data ?? []
          }),
          pvpChallenges.listLockedBySeason(seasonId).then(({ data }) => {
            seasonPvpData = data ?? []
          }),
          bountyPosts.listBySeason(seasonId).then(({ data }) => {
            seasonBountyData = data ?? []
          })
        )
      }

      // Caller's own active loan (for the net-worth context on the hub)
      let myLoansData: any[] = []
      if (playerId) {
        fetches.push(
          loans.listByPlayer(playerId).then(({ data }) => {
            myLoansData = data ?? []
          })
        )
      }

      // Player's bets and ledger balance
      let myBetsData: any[] = []
      let ledgerData: any[] = []
      if (playerId && seasonId) {
        fetches.push(
          bets.listByPlayer(playerId).then(({ data }) => {
            myBetsData = data ?? []
          }),
          pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            ledgerData = data ?? []
          })
        )
      }

      await Promise.all(fetches)

      // Resolve custom lines against the RAW market views (pre-policy: before
      // "Your Team" reshaping / under-hiding) — specials may bundle selections
      // the viewer's own board hides.
      const rawLineViews = [...marketsData, ...moneylineData, ...propData].map(normalizeMarket)
      const slotByPlayer = new Map<string, { teamId: string; playerName: string }>()
      for (const s of weekSlotsData) {
        if (s.player_id) slotByPlayer.set(s.player_id, { teamId: s.team_id, playerName: s.players?.name ?? '—' })
      }
      const applicableCustom = customLinesData.filter(
        cl => cl.week_ids == null || (weekId != null && cl.week_ids.includes(weekId))
      )
      // Resolve a row into board instances for one taker: lines with a null-game
      // ("every game") leg materialize once per game on this week's schedule;
      // fixed-game lines resolve once. Self-referential legs bind to the taker.
      const weekGameNumbers = [...new Set(
        rawLineViews.map(l => l.gameNumber).filter((g): g is number => g != null)
      )].sort((a, b) => a - b)
      const resolveInstances = (cl: any, taker: string | null): CustomLineView[] => {
        const perGame = Array.isArray(cl.legs) && cl.legs.some((l: any) => l?.game_number == null)
        const instances = perGame
          ? weekGameNumbers.map(g => resolveCustomLine(cl, rawLineViews, slotByPlayer, taker, g))
          : [resolveCustomLine(cl, rawLineViews, slotByPlayer, taker, null)]
        return instances.filter((v): v is CustomLineView => v != null)
      }
      // The viewer's board.
      const resolvedCustom: CustomLineView[] = applicableCustom.flatMap(cl => resolveInstances(cl, playerId))

      // Best-effort special branding on bets: a bet whose selections exactly
      // match a resolved line's bundle gets the custom title. Past-week bets
      // (whose markets aren't in this week's resolution) render as plain parlays.
      const brandBySelections = new Map<string, { title: string; category: string }>()
      const addBrand = (cl: CustomLineView) => {
        brandBySelections.set([...cl.selectionIds].sort().join('|'), { title: cl.title, category: cl.category })
      }
      resolvedCustom.forEach(addBrand)
      // Self-referential lines resolve to different selections per taker, so the
      // viewer-resolved entries only match the viewer's own bets. Re-resolve those
      // lines for every bettor in view so their bets brand correctly too.
      const selfLines = applicableCustom.filter(
        cl => Array.isArray(cl.legs) && cl.legs.some((l: any) => l?.player_id == null)
      )
      if (selfLines.length > 0) {
        const bettorIds = new Set<string>()
        for (const b of [...weekBetsData, ...settledBetsData]) {
          if (b.player_id && b.player_id !== playerId) bettorIds.add(b.player_id)
        }
        for (const cl of selfLines) {
          for (const pid of bettorIds) resolveInstances(cl, pid).forEach(addBrand)
        }
      }
      const brandBet = (b: BetView): BetView => {
        // The DB snapshot (stamped at placement) wins; matching is the legacy
        // fallback for bets placed before tagging existed.
        if (b.customLineTitle != null || b.legCount === 0) return b
        const brand = brandBySelections.get(b.legs.map(l => l.selectionId).sort().join('|'))
        return brand ? { ...b, customLineTitle: brand.title, customLineCategory: brand.category } : b
      }

      const weekBetViews = weekBetsData.map(normalizeBet).map(brandBet)
      const myBetViews = myBetsData.map(normalizeBet).map(brandBet)

      // Cutoff for "last week's results": the most recent settlement (score_credit)
      // timestamp in the season ledger. priorBalance sums only rows strictly before
      // it — i.e. each player's standing *before* last week's scores posted. Derived
      // from the ledger itself (not weeks.created_at) so it survives inconsistent
      // backfill timestamps. null = no settled week yet → no baseline to diff.
      let settleCutoff: string | null = null
      for (const e of seasonLedger) {
        if (e.type === 'score_credit' && e.created_at && (!settleCutoff || e.created_at > settleCutoff)) {
          settleCutoff = e.created_at
        }
      }

      // Sum the season ledger per player (house rows already excluded), keep
      // active players, sort high → low.
      const byPlayer: Record<string, { playerId: string; name: string; balance: number; priorBalance: number; isActive: boolean }> = {}
      for (const e of seasonLedger) {
        const pid = e.player_id
        if (!pid) continue
        if (!byPlayer[pid]) {
          byPlayer[pid] = {
            playerId: pid,
            name: e.players?.name ?? '—',
            balance: 0,
            priorBalance: 0,
            isActive: e.players?.is_active ?? true,
          }
        }
        byPlayer[pid].balance += e.amount
        if (settleCutoff && e.created_at && e.created_at < settleCutoff) {
          byPlayer[pid].priorBalance += e.amount
        }
      }
      // Per-player "open action": at-risk pins escrowed across the Pinsino,
      // already debited from balance at placement, so this recovers the at-risk
      // portion for display + the net-worth calc. Three sources:
      //  • Sportsbook — stakes on pending bets.
      //  • PvP — each side's stake on locked (accepted, unsettled) contracts.
      //  • Bounties — active (unsettled) hunter-entry stakes. (Player sponsorship
      //    is House-only in v1, so there's no player sponsor escrow.)
      const openActionByPlayer: Record<string, number> = {}
      const addAction = (pid: string | null | undefined, amount: number) => {
        if (!pid || !amount) return
        openActionByPlayer[pid] = (openActionByPlayer[pid] ?? 0) + amount
      }
      for (const b of weekBetViews) {
        if (b.status === 'pending') addAction(b.playerId, b.stake)
      }
      for (const c of seasonPvpData) {
        if (c.status !== 'locked') continue
        addAction(c.creator_player_id, c.creator_stake)
        addAction(c.counterparty_player_id, c.counterparty_stake)
      }
      for (const bounty of seasonBountyData) {
        for (const s of (bounty.bounty_hunter_stakes ?? [])) {
          if (s.status === 'active') addAction(s.player_id, s.stake_amount)
        }
      }

      // Per-player active-loan debt (sum of loan_ledger amounts on active loans).
      const debtByPlayer: Record<string, number> = {}
      for (const d of seasonDebt) {
        if (!d.player_id) continue
        debtByPlayer[d.player_id] = (debtByPlayer[d.player_id] ?? 0) + d.amount
      }

      const activePlayers = Object.values(byPlayer).filter(p => p.isActive)

      // Prior-week ranking (by balance before last week's results posted). Skip it
      // entirely when the baseline is degenerate — no settled week, or every prior
      // balance is identical (the all-backfilled-at-once state) — so we don't draw
      // arrows off an arbitrary tie-break order.
      const priorRank = new Map<string, number>()
      const distinctPrior = new Set(activePlayers.map(p => p.priorBalance))
      if (settleCutoff && distinctPrior.size > 1) {
        activePlayers
          .slice()
          .sort((a, b) => b.priorBalance - a.priorBalance)
          .forEach((p, i) => priorRank.set(p.playerId, i))
      }

      const board = activePlayers
        .map(({ playerId, name, balance }) => {
          const openAction = openActionByPlayer[playerId] ?? 0
          const debt = debtByPlayer[playerId] ?? 0
          return {
            playerId,
            name,
            balance,
            openAction,
            debt,
            netWorth: balance + openAction - debt,
          }
        })
        .sort((a, b) => b.netWorth - a.netWorth)
        .map((p, i) => {
          const prev = priorRank.get(p.playerId)
          const movement: 'up' | 'down' | 'same' | null =
            prev === undefined ? null : i < prev ? 'up' : i > prev ? 'down' : 'same'
          return { ...p, movement }
        })

      // Caller's own loan figures. Outstanding is the per-player active-loan debt
      // already summed for the leaderboard; the active loan row carries its product.
      const myDebt = playerId ? (debtByPlayer[playerId] ?? 0) : 0
      const myActiveLoan = myLoansData.find((l: any) => l.status === 'active')

      setDebt(myDebt)
      // The caller's own at-risk pins fall straight out of the per-player map.
      setOpenAction(playerId ? (openActionByPlayer[playerId] ?? 0) : 0)
      setActiveLoan(
        myActiveLoan
          ? {
              loanId: myActiveLoan.id,
              productName: myActiveLoan.loan_products?.display_name ?? '—',
              outstanding: myDebt,
            }
          : null
      )

      // Build the board: O/U lines pass through; moneylines are reduced to the
      // player's own team ("Your Team"), dropping matchups they're not in.
      const openLinesResolved: LineView[] = []
      for (const line of rawLineViews) {
        if (line.marketType === 'moneyline') {
          const ml = toYourTeamMoneyline(line, myTeamId)
          if (ml) openLinesResolved.push(ml)
        } else {
          openLinesResolved.push(line)
        }
      }
      setOpenLines(openLinesResolved)
      setCustomLineViews(resolvedCustom)
      setWeekBets(weekBetViews)
      setSettledBets(settledBetsData.map(normalizeBet).map(brandBet))
      setLeaderboard(board)
      setMyBets(myBetViews)
      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))
      setMyBetMarketIds(new Set(myBetViews.map(b => b.marketId)))
    } catch (e) {
      console.error('usePinsinoData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, debt, openAction, netWorth: balance + openAction - debt, activeLoan, openLines, customLines: customLineViews, myBets, weekBets, settledBets, leaderboard, myBetMarketIds, currentWeekId, currentSeasonId, reload: load }
}
