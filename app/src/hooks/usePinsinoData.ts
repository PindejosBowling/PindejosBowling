import { weeks, seasons, betMarkets, bets, pinLedger, loanLedger, loans, pvpChallenges, bountyPosts, teamSlots, customLines, games, players, auctionHouseState } from '../utils/supabase/db'
import { computeBalance } from '../utils/ledger'
import { betPayout } from '../utils/bets'
import { useAsyncData } from './useAsyncData'

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
  // Stat key (bet_markets.params.stat) for prop/team_prop markets; null otherwise.
  statKey: string | null
  // Anchored team (bet_markets.params.team_id) for team_prop markets; null
  // otherwise. Drives the "Your Team" label + the own-team anti-tank pre-check.
  teamId: string | null
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
  // Team-aggregate props: the under bets against the anchored team (the
  // "subject" is the team — callers key ownership off LineView.teamId).
  if (marketType === 'team_prop') return selectionKey === 'under'
  return false
}

// UI-only policy: the "under" side of player O/U, stat-prop, and team-prop
// lines is hidden from the Sportsbook. Betting on leaguemates (or a whole
// team) to do *poorly* has negative social dynamics in a small rec league, so
// we don't surface it as a pick. This is a pure presentation filter — the
// selection still exists in the DB and the place/settlement RPCs
// (`place_house_bet`, etc.) handle `under` unchanged, so the mechanic can be
// restored by removing this filter. See AGENTS.md. Lives here (not on the
// screen) so both the board and the "Copy this bet" flow share one policy.
export function isSelectionHiddenInUI(line: LineView, sel: SelectionView): boolean {
  return (
    (line.marketType === 'over_under' || line.marketType === 'prop' || line.marketType === 'team_prop') &&
    sel.key === 'under'
  )
}

// Drop UI-hidden selections from a line, returning the same object when nothing
// changes (keeps referential stability for memoization downstream).
export function withVisibleSelections(line: LineView): LineView {
  const selections = line.selections.filter(s => !isSelectionHiddenInUI(line, s))
  return selections.length === line.selections.length ? line : { ...line, selections }
}

// Display labels for the LaneTalk stat-prop kinds (bet_markets.params.stat).
export const STAT_LABELS: Record<string, string> = {
  strikes: 'Strikes',
  spares: 'Spares',
  clean_frames: 'Clean Frames',
  // team_prop only — the team's summed pinfall for a game.
  total_pins: 'Total Pins',
  // Retired for new markets (clean_pct replaced by clean_frames; first_ball_avg
  // dropped as a bettable line) — kept so settled history renders its label.
  clean_pct: 'Clean %',
  first_ball_avg: 'First-Ball Avg',
}

// The pick button IS the line being agreed to. Every side offered on the board
// is an over (unders are UI-hidden — all bets are over by definition), so the
// button reads as the full condition: threshold + what's being counted —
// "142.5+ PINS" on a score line, "4.5+ STRIKES" / "62.5+ CLEAN %" on a stat
// prop. Lineless sides (moneyline "WIN") keep their label.
export function selectionButtonLabel(line: LineView, sel: SelectionView): string {
  const threshold = sel.line ?? line.line
  if (sel.key === 'over' && threshold != null) {
    const what =
      line.marketType === 'prop' || line.marketType === 'team_prop'
        ? line.statKey ? STAT_LABELS[line.statKey] ?? line.statKey : null
        // Score lines: a game row reads "PINS"; the night line matches the
        // team row's "TOTAL PINS" wording (it IS the night total).
        : line.marketType === 'over_under' ? (line.gameNumber != null ? 'Pins' : 'Total Pins') : null
    return `${threshold.toFixed(1)}+${what ? ` ${what.toUpperCase()}` : ''}`
  }
  return (sel.label || sel.key).toUpperCase()
}

// The line suffix placed-bet surfaces append after the pick ("OVER 4.5 STRIKES",
// "OVER 142.5"). One helper so every gate (BetRow, detail/settle modals, parlay
// slips) treats stat props and score O/U the same way.
export function betLineSuffix(marketType: string, line: number | null, statKey?: string | null): string {
  if (line == null) return ''
  if (marketType === 'over_under') return ` ${line.toFixed(1)}`
  if (marketType === 'prop' || marketType === 'team_prop') {
    const label = statKey ? STAT_LABELS[statKey] ?? statKey : null
    return ` ${line.toFixed(1)}${label ? ` ${label.toUpperCase()}` : ''}`
  }
  return ''
}

// One resolved special leg as a display string — shared by the board row and
// the bet-slip summary so every surface labels legs identically:
// "Alice · OVER 4.5 STRIKES · G1", "Your Team · OVER 612.5 TOTAL PINS · NIGHT".
// Declared before CustomLegView is defined, so typed structurally.
export function customLegLabel(leg: {
  subjectName: string
  pick: string
  marketType: string
  line: number | null
  statKey: string | null
  gameNumber: number | null
}): string {
  const suffix = betLineSuffix(leg.marketType, leg.line, leg.statKey)
  const where =
    leg.gameNumber != null ? ` · G${leg.gameNumber}` : leg.marketType === 'moneyline' ? '' : ' · NIGHT'
  return `${leg.subjectName} · ${leg.pick.toUpperCase()}${suffix}${where}`
}

// The section a line is bucketed under on the Place Bets board. Per-game markets
// group by game number; markets with no game (season-long / futures) share one
// group. New market kinds slot in here without the screen knowing their shape.
export interface LineGroup {
  key: string        // stable grouping key (also the React key)
  label: string      // section header — "GAME 1", "SEASON", …
  sortOrder: number  // ascending display order (game order, season-long last)
}

// The grouping primitive shared by the Place Bets board (lines) and the
// Active Bets board (placed bets): a market's section follows purely from its
// game number + type, so both surfaces bucket identically and no market kind
// can fall through the cracks (e.g. night-scoped props with no game number).
export function marketGroup(gameNumber: number | null, marketType: string): LineGroup {
  if (gameNumber != null) {
    return { key: `game-${gameNumber}`, label: `GAME ${gameNumber}`, sortOrder: gameNumber }
  }
  // Night-scoped markets — player stat props, team props, and the player
  // night total-pins O/U (no single game, settled over the whole night) —
  // lead the board, above the game groups (game numbers start at 1).
  if (marketType === 'prop' || marketType === 'team_prop' || marketType === 'over_under') {
    return { key: 'weekly', label: 'WEEKLY', sortOrder: 0 }
  }
  // Season-long / futures markets (no game scope) collect at the end.
  return { key: 'season', label: 'SEASON', sortOrder: Number.MAX_SAFE_INTEGER }
}

export function lineGroup(line: LineView): LineGroup {
  return marketGroup(line.gameNumber, line.marketType)
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
      return { key: 'player_ou', label: 'Player Overs', sortOrder: 1 }
    case 'team_prop':
      // Team lines live INSIDE the game listing alongside the player rows: a
      // team's moneyline (viewer's team only — toYourTeamMoneyline) and its
      // team_prop stat lines consolidate into ONE row (rowKey = teamId) shown
      // above that team's player rows (the screen's team-block sorting).
      // Night team props (no game number) join the WEEKLY group's night
      // section instead, consolidating per team the same way.
      return line.gameNumber != null
        ? { key: 'player_ou', label: 'Player Overs', sortOrder: 1 }
        : { key: 'night_props', label: 'Night Props', sortOrder: 0 }
    case 'over_under':
      // Only the "over" side is bettable in the UI (the "under" is hidden — see
      // SportsbookScreen / context/betting-line-board.md), so the section reads
      // "Player Overs" rather than "Player Over/Unders". The night total-pins
      // O/U (no game number) joins the WEEKLY group's night section, leading
      // its player's consolidated night row.
      return line.gameNumber != null
        ? { key: 'player_ou', label: 'Player Overs', sortOrder: 1 }
        : { key: 'night_props', label: 'Night Props', sortOrder: 0 }
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

// This week's team topology, for the board's with/against presentation.
export interface WeekTeams {
  myTeamId: string | null
  // player id → their team id this week (from team_slots).
  teamByPlayer: Record<string, string>
  // game number → the team the VIEWER's team plays in that game.
  opponentTeamByGame: Record<number, string>
}
export const EMPTY_WEEK_TEAMS: WeekTeams = { myTeamId: null, teamByPlayer: {}, opponentTeamByGame: {} }

// The viewer's relationship to a line's subject — drives the subtle row tint
// on the board. 'with' = the subject is on the viewer's team this week;
// 'against' = the subject's team is the viewer's matchup opponent (in that
// game for per-game lines; in any game for night lines); null = neutral.
export function subjectRelation(
  teams: WeekTeams,
  subjectPlayerId: string | null,
  gameNumber: number | null,
): 'with' | 'against' | null {
  if (!subjectPlayerId || !teams.myTeamId) return null
  const team = teams.teamByPlayer[subjectPlayerId]
  if (!team) return null
  if (team === teams.myTeamId) return 'with'
  if (gameNumber != null) return teams.opponentTeamByGame[gameNumber] === team ? 'against' : null
  return Object.values(teams.opponentTeamByGame).includes(team) ? 'against' : null
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
  result: string | null     // won | lost | push | void | crutched | null (pending)
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
  // The custom_lines row this bet is tagged with (place_house_bet's
  // p_custom_line_id). Non-null ⇒ a Special. Used to re-place ("copy") the same
  // special — place_house_bet only requires it to exist and be live, so the
  // selections are re-resolved client-side like any parlay.
  customLineId: string | null
  // Attachable items spent on this bet at placement (win or lose). Non-null =
  // attached; each pays out (or is simply spent) at settlement per its mechanic.
  // All three are surfaced in the Bet Details overlay.
  //   insurance — Golden Ticket (bet_insurance): refunds the stake if the bet loses.
  //   crutch    — Winner's Crutch (parlay_crutch): cancels the lone losing leg of a parlay.
  //   boost     — Energy Drink (odds_boost): House-funded total-payout doubler on a win.
  insuranceItemId: string | null
  crutchItemId: string | null
  boostItemId: string | null
  // The attached Energy Drink's boost multiplier, snapshotted from its catalog
  // effect_params at placement (null = no boost). Bonus on a win =
  // floor(potentialPayout × boostPct); see betBoostBonus in utils/bets.
  boostPct: number | null
}

// One row in the season pin-balance scoreboard (High Rollers).
export interface LeaderboardEntry {
  playerId: string
  name: string
  balance: number
  openAction: number    // at-risk escrow: pending bets + locked PvP + active bounties
  debt: number          // outstanding active-loan debt (≥ 0)
  netWorth: number      // balance + openAction − debt
  openBetCount: number  // pending sportsbook bets (excludes PvP/bounty action)
  openBetProfit: number // profit above stake if every pending bet hits (incl. boost bonuses) —
                        // stake-exclusive because netWorth already counts open stakes via openAction
  movement: 'up' | 'down' | 'same' | null
  // Balance partition mirroring PlayerPinsinoScreen's summary card, reconciled to
  // the net-worth headline: pincome + gaming + loanProceeds − debt === netWorth.
  pincome: number       // scores bowled + house bonuses (score_credit, bonus, rsvp_bonus)
  loanProceeds: number  // net cash the loan system moved through balance (loan_*)
  gaming: number        // remainder incl. at-risk open action (bets, PvP, bounties, auctions, items)
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
    customLineId: b.custom_line_id ?? null,
    insuranceItemId: b.insurance_item_id ?? null,
    crutchItemId: b.crutch_item_id ?? null,
    boostItemId: b.boost_item_id ?? null,
    boostPct: b.boost_pct != null ? Number(b.boost_pct) : null,
  }
}

export function normalizeMarket(m: any): LineView {
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

  // Stat props (player + team) carry their kind in params.stat; the full
  // condition (threshold + stat) renders in the pick button
  // (selectionButtonLabel), so no subtitle.
  const statKey: string | null =
    m.market_type === 'prop' || m.market_type === 'team_prop' ? m.params?.stat ?? null : null
  // team_prop rows are anchored to a team, not a player: params carries the
  // team id (ownership checks) + team number (display label).
  const teamId: string | null = m.market_type === 'team_prop' ? m.params?.team_id ?? null : null
  const teamNumber: number | null = m.market_type === 'team_prop' ? m.params?.team_number ?? null : null

  return {
    marketId: m.id,
    marketType: m.market_type,
    title: m.title ?? '',
    subjectPlayerId: m.subject_player_id ?? null,
    // O/U markets name a player (subject); team props name their team;
    // moneylines name a matchup via the market title (subject is a game, so
    // the player embed resolves null).
    subjectName:
      m.subject?.name ?? (teamNumber != null ? `Team ${teamNumber}` : m.title ?? '—'),
    gameNumber: m.game_number ?? null,
    line: sharedLine,
    statKey,
    teamId,
    selections,
    inProgress: m.status === 'closed',
  }
}

// Sportsbook social policy: a player may only bet their OWN team to win. Each
// moneyline market is reduced to the single selection for the player's week team
// (the opponent side is hidden). It's reshaped to mirror a player-prop row:
//   subject "Your Team" · subtitle "vs <opponent>" · button "WIN".
// The opponent's label is the metadata we keep before dropping that selection.
// Markets not involving the player's team (the other matchups) drop out — so a
// player sees exactly their own team's moneyline per game. `teamId` is stamped
// with the viewer's team so the board consolidates this row with the team's
// team_prop lines (one "Your Team" row: WIN + the team stat buttons).
function toYourTeamMoneyline(line: LineView, myTeamId: string | null): LineView | null {
  const mine = myTeamId ? line.selections.find(s => s.key === myTeamId) : undefined
  if (!mine) return null
  const opponent = line.selections.find(s => s.key !== mine.key)
  return {
    ...line,
    subjectName: 'Your Team',
    teamId: myTeamId,
    subtitle: opponent ? `vs ${opponent.label}` : undefined,
    selections: [{ ...mine, label: 'Win' }],
  }
}

// ── Custom lines ("Specials") ────────────────────────────────────────────────
// Admin-authored templates bundling existing selections under a custom title
// (custom_lines table). Legs are abstract specs re-resolved against each week's
// auto-generated markets; taking a special places an ordinary single/parlay via
// bets.place. See context/betting-line-board.md.

// One leg spec as stored in custom_lines.legs jsonb. Team-anchored legs
// (moneyline, team_prop) mean "the team containing player_id" — anchored by
// player because team ids don't persist across weeks. Two fields are
// relative-by-null:
//  • player_id null = THE BETTOR (self-referential): the subject is whoever
//    takes the bet, so the line resolves per-viewer ("you beat your over").
//  • game_number null at game scope = EVERY GAME: the line materializes once
//    per game that week, each instance binding its null-game legs to that game
//    ("the bettor bowls their over in this game" → one offering per game group).
// Legacy rows (created before props/team props) carry only kind/player_id/
// game_number/pick — a missing scope always reads as 'game', so night lines are
// reachable only via an explicit scope:'night' and legacy EACH semantics are
// untouched. The creator emits only 'over'/'win' picks; 'under' survives in
// old rows and still resolves.
export interface CustomLegSpec {
  kind: 'over_under' | 'moneyline' | 'prop' | 'team_prop'
  player_id: string | null
  // Stat key for prop (strikes|spares|clean_frames) and team_prop
  // (total_pins|clean_frames|strikes|spares) legs; absent otherwise.
  stat?: string
  // absent = legacy = 'game'. Night legs ignore game_number (always null).
  scope?: 'game' | 'night'
  game_number: number | null
  pick: 'over' | 'under' | 'win'
}

// A leg spec resolved against this week's markets — carries everything the
// board, the take sheet, and the anti-tank check need.
export interface CustomLegView {
  selectionId: string
  marketId: string
  marketType: string
  subjectName: string          // O/U player name, or "<anchor>'s Team" for team legs
  subjectPlayerId: string | null
  pick: string                 // display label: 'Over' / 'Under' / 'Win'
  selectionKey: string         // raw side key ('over' / 'under' / a team uuid)
  line: number | null
  statKey: string | null       // params.stat of the matched market (prop/team_prop)
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
    // Night legs live on the null-game market; game legs bind a fixed number or
    // the instance's game (EACH). Legacy specs have no scope → 'game'.
    const scope = spec.scope ?? 'game'
    const legGame = scope === 'night' ? null : (spec.game_number ?? instanceGame)
    if (scope === 'game' && legGame == null) return null
    let line: LineView | undefined
    let sel: SelectionView | undefined
    let subjectName = ''
    if (spec.kind === 'over_under' || spec.kind === 'prop') {
      line = rawLines.find(
        l =>
          l.marketType === spec.kind &&
          l.subjectPlayerId === subjectId &&
          l.gameNumber === legGame &&
          (spec.kind === 'prop' ? l.statKey === spec.stat : true)
      )
      sel = line?.selections.find(s => s.key === spec.pick)
      subjectName = spec.player_id == null ? 'You' : (line?.subjectName ?? '')
    } else {
      // Team legs (moneyline win, team_prop stat): resolve the anchor player to
      // their week team, then match that team's market.
      const slot = slotByPlayer.get(subjectId)
      if (!slot) return null
      if (spec.kind === 'moneyline') {
        line = rawLines.find(
          l => l.marketType === 'moneyline' && l.gameNumber === legGame && l.selections.some(s => s.key === slot.teamId)
        )
        sel = line?.selections.find(s => s.key === slot.teamId)
      } else {
        line = rawLines.find(
          l =>
            l.marketType === 'team_prop' &&
            l.teamId === slot.teamId &&
            l.statKey === spec.stat &&
            l.gameNumber === legGame
        )
        sel = line?.selections.find(s => s.key === spec.pick)
      }
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
      statKey: line.statKey,
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

interface PinsinoPayload {
  balance: number
  openLines: LineView[]
  myBets: BetView[]
  // All bets placed by every player this week (for the "Active Bets" view)
  weekBets: BetView[]
  // All settled (won/lost/push) bets this season (for the "Settled Bets" view)
  settledBets: BetView[]
  // Season pin-balance scoreboard: active players sorted high → low.
  // `movement` = rank change vs. the prior week (null = no prior week / new entry).
  leaderboard: LeaderboardEntry[]
  currentWeekId: string | null
  currentSeasonId: string | null
  // The displayed season's number, and whether it is a concluded season being
  // shown as a frozen final outcome (no live season active). Drives the
  // "Final Results" banner between season close and the next season's start.
  seasonNumber: number | null
  seasonConcluded: boolean
  // Set of market ids the current player has already placed a bet on
  myBetMarketIds: Set<string>
  // Admin custom lines ("Specials") resolved + available this week.
  customLines: CustomLineView[]
  // Caller's own loan figures (net-worth context near the balance card)
  debt: number
  // Caller's own at-risk pins escrowed across the Pinsino — pending sportsbook
  // bets + locked PvP contracts + active bounty entries. Already debited from
  // balance at placement, so this recovers the at-risk portion for the net calc.
  openAction: number
  activeLoan: ActiveLoanSummary | null
  // This week's team topology, for the board's with/against presentation:
  // every player's team, the viewer's team, and per game the team the
  // viewer's team is matched up against.
  weekTeams: WeekTeams
  // Auction House admin kill-switch for the live season. Drives the "closed"
  // status overlay + entry gate on the Pinsino tile (live mode only).
  auctionHouseClosed: boolean
  auctionHouseClosedMessage: string | null
}

const EMPTY: PinsinoPayload = {
  balance: 0,
  openLines: [],
  myBets: [],
  weekBets: [],
  settledBets: [],
  leaderboard: [],
  currentWeekId: null,
  currentSeasonId: null,
  seasonNumber: null,
  seasonConcluded: false,
  myBetMarketIds: new Set(),
  customLines: [],
  debt: 0,
  openAction: 0,
  activeLoan: null,
  weekTeams: EMPTY_WEEK_TEAMS,
  auctionHouseClosed: false,
  auctionHouseClosedMessage: null,
}

export function usePinsinoData(playerId: string | null, viewSeasonId?: string | null) {
  const { loading, data, reload } = useAsyncData<PinsinoPayload>(async () => {
      // Past-season mode: an explicit prior season is requested. The economy is
      // season-scoped, so we just point `seasonId` at it and null out `weekId` —
      // every live/week-scoped fetch below is guarded by `if (weekId)`, so the
      // board/active-bets vanish automatically and only the season's final
      // leaderboard + settled history loads. `readOnly` drives the UI gating.
      let weekId: string | null
      let seasonId: string | null
      // The resolved season's number — used to scope the player's all-time bets
      // to the viewed season in past-season mode.
      let resolvedSeasonNumber: number | null
      let seasonConcluded: boolean
      if (viewSeasonId) {
        const seasonRes = await seasons.getById(viewSeasonId)
        weekId = null
        seasonId = seasonRes.data?.id ?? null
        resolvedSeasonNumber = seasonRes.data?.number ?? null
        // A prior season is by definition concluded → show the FINAL banner.
        seasonConcluded = true
      } else {
        const [weekRes, seasonRes] = await Promise.all([
          weeks.getCurrent(),
          seasons.getCurrentOrLastEnded(),
        ])

        // Week stays current-only (null between seasons → live board correctly
        // empty); the season falls back to the most-recently-ended one so its
        // final outcome stays visible until the next season starts.
        weekId = weekRes.data?.id ?? null
        seasonId = seasonRes.data?.id ?? null
        resolvedSeasonNumber = seasonRes.data?.number ?? null
        seasonConcluded = seasonRes.concluded
      }

      const fetches: PromiseLike<any>[] = []

      // Open O/U + moneyline + stat-prop + team-prop markets + all bets for this week
      let marketsData: any[] = []
      let moneylineData: any[] = []
      let propData: any[] = []
      let teamPropData: any[] = []
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
      // resolving moneyline anchor legs of any player, not just the caller) +
      // the schedule (matchups → the board's with/against tinting).
      let customLinesData: any[] = []
      let weekSlotsData: any[] = []
      let weekGamesData: any[] = []
      if (weekId) {
        fetches.push(
          games.listByWeek(weekId).then(({ data }) => {
            weekGamesData = data ?? []
          }),
          betMarkets.listActiveOUByWeek(weekId).then(({ data }) => {
            marketsData = data ?? []
          }),
          betMarkets.listActiveMoneylineByWeek(weekId).then(({ data }) => {
            moneylineData = data ?? []
          }),
          betMarkets.listActivePropByWeek(weekId).then(({ data }) => {
            propData = data ?? []
          }),
          betMarkets.listActiveTeamPropByWeek(weekId).then(({ data }) => {
            teamPropData = data ?? []
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
      // All players registered for the season — so the scoreboard lists everyone
      // in the season, even players with no ledger activity yet (seeded at 0).
      let seasonPlayersData: any[] = []
      if (seasonId) {
        fetches.push(
          pinLedger.listBySeasonForLeaderboard(seasonId).then(({ data }) => {
            seasonLedger = data ?? []
          }),
          players.listBySeason(seasonId).then(({ data }) => {
            seasonPlayersData = data ?? []
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

      // Auction House open/closed state — a live-only concept, so it's skipped
      // in past-season review (viewSeasonId set). Absent row = open.
      let auctionStateData: any = null
      if (seasonId && !viewSeasonId) {
        fetches.push(
          auctionHouseState.getBySeason(seasonId).then(({ data }) => {
            auctionStateData = data
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
      const rawLineViews = [...marketsData, ...moneylineData, ...propData, ...teamPropData].map(normalizeMarket)
      const slotByPlayer = new Map<string, { teamId: string; playerName: string }>()
      for (const s of weekSlotsData) {
        if (s.player_id) slotByPlayer.set(s.player_id, { teamId: s.team_id, playerName: s.players?.name ?? '—' })
      }

      // Week team topology for the board's with/against tinting.
      const teamByPlayer: Record<string, string> = {}
      for (const [pid, slot] of slotByPlayer) teamByPlayer[pid] = slot.teamId
      const opponentTeamByGame: Record<number, string> = {}
      if (myTeamId) {
        for (const g of weekGamesData) {
          if (g.team_a_id === myTeamId) opponentTeamByGame[g.game_number] = g.team_b_id
          else if (g.team_b_id === myTeamId) opponentTeamByGame[g.game_number] = g.team_a_id
        }
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
        // Only game-scope null-game legs mean EACH; night legs also carry a
        // null game_number but resolve once (against the night market).
        const perGame = Array.isArray(cl.legs) &&
          cl.legs.some((l: any) => l?.game_number == null && (l?.scope ?? 'game') === 'game')
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
      // `bets.listByPlayer` is all-time; in past-season mode scope the player's
      // own bets to the viewed season so the history doesn't mix seasons. (The
      // leaderboard + settled views are already season-scoped server-side.)
      const myBetViews = myBetsData
        .map(normalizeBet)
        .map(brandBet)
        .filter(b => !viewSeasonId || b.seasonNumber === resolvedSeasonNumber)

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
      // Per-player accumulator. `pincome`/`loanProceeds` mirror PlayerPinsinoScreen's
      // buckets; `gaming` is derived later as the balance remainder so the three
      // always reconcile even for ledger types added later.
      const byPlayer: Record<string, { playerId: string; name: string; balance: number; priorBalance: number; pincome: number; loanProceeds: number; isActive: boolean }> = {}
      const seedRow = (playerId: string, name: string, isActive: boolean) => ({
        playerId, name, balance: 0, priorBalance: 0, pincome: 0, loanProceeds: 0, isActive,
      })
      // Seed every registered player at zero first, so the scoreboard includes
      // players who haven't touched the economy yet; ledger rows then add on top.
      for (const p of seasonPlayersData) {
        if (!p.id || byPlayer[p.id]) continue
        byPlayer[p.id] = seedRow(p.id, p.name ?? '—', p.is_active ?? true)
      }
      for (const e of seasonLedger) {
        const pid = e.player_id
        if (!pid) continue
        if (!byPlayer[pid]) {
          byPlayer[pid] = seedRow(pid, e.players?.name ?? '—', e.players?.is_active ?? true)
        }
        byPlayer[pid].balance += e.amount
        if (e.type === 'score_credit' || e.type === 'bonus' || e.type === 'rsvp_bonus') byPlayer[pid].pincome += e.amount
        else if (typeof e.type === 'string' && e.type.startsWith('loan_')) byPlayer[pid].loanProceeds += e.amount
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
      // Pending-bet count + possible profit feed the leaderboard's 🎟️ tracker
      // (sportsbook only, unlike openAction which also folds in PvP + bounty
      // escrow). Profit is stake-exclusive (betPayout − stake, boost incl.):
      // netWorth already credits open stakes via openAction, so showing full
      // payout would double-count the stake portion.
      const openBetCountByPlayer: Record<string, number> = {}
      const openBetProfitByPlayer: Record<string, number> = {}
      for (const b of weekBetViews) {
        if (b.status === 'pending') {
          addAction(b.playerId, b.stake)
          if (b.playerId) {
            openBetCountByPlayer[b.playerId] = (openBetCountByPlayer[b.playerId] ?? 0) + 1
            openBetProfitByPlayer[b.playerId] = (openBetProfitByPlayer[b.playerId] ?? 0) + (betPayout(b) - b.stake)
          }
        }
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
        .map(({ playerId, name, balance, pincome, loanProceeds }) => {
          const openAction = openActionByPlayer[playerId] ?? 0
          const debt = debtByPlayer[playerId] ?? 0
          return {
            playerId,
            name,
            balance,
            openAction,
            debt,
            netWorth: balance + openAction - debt,
            openBetCount: openBetCountByPlayer[playerId] ?? 0,
            openBetProfit: openBetProfitByPlayer[playerId] ?? 0,
            pincome,
            loanProceeds,
            // Fold at-risk open action into gaming so the buckets reconcile to
            // netWorth: pincome + gaming + loanProceeds − debt === balance + openAction − debt.
            gaming: balance + openAction - pincome - loanProceeds,
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

      // Build the board: O/U lines pass through; moneylines are reduced to the
      // player's own team ("Your Team"), dropping matchups they're not in;
      // team props keep every team but relabel the viewer's own.
      const openLinesResolved: LineView[] = []
      for (const line of rawLineViews) {
        if (line.marketType === 'moneyline') {
          const ml = toYourTeamMoneyline(line, myTeamId)
          if (ml) openLinesResolved.push(ml)
        } else if (line.marketType === 'team_prop' && line.teamId != null && line.teamId === myTeamId) {
          openLinesResolved.push({ ...line, subjectName: 'Your Team' })
        } else {
          openLinesResolved.push(line)
        }
      }

      return {
        balance: computeBalance(ledgerData),
        openLines: openLinesResolved,
        myBets: myBetViews,
        weekBets: weekBetViews,
        settledBets: settledBetsData.map(normalizeBet).map(brandBet),
        leaderboard: board,
        currentWeekId: weekId,
        currentSeasonId: seasonId,
        seasonNumber: resolvedSeasonNumber,
        seasonConcluded,
        myBetMarketIds: new Set(myBetViews.map(b => b.marketId)),
        customLines: resolvedCustom,
        debt: myDebt,
        // The caller's own at-risk pins fall straight out of the per-player map.
        openAction: playerId ? (openActionByPlayer[playerId] ?? 0) : 0,
        activeLoan: myActiveLoan
          ? {
              loanId: myActiveLoan.id,
              productName: myActiveLoan.loan_products?.display_name ?? '—',
              outstanding: myDebt,
            }
          : null,
        weekTeams: { myTeamId, teamByPlayer, opponentTeamByGame },
        auctionHouseClosed: auctionStateData?.is_closed ?? false,
        auctionHouseClosedMessage: auctionStateData?.closed_message ?? null,
      }
  }, [playerId, viewSeasonId], 'usePinsinoData')

  // True when viewing a specific prior season (drives read-only UI gating).
  const readOnly = viewSeasonId != null

  const view = data ?? EMPTY
  return { loading, ...view, netWorth: view.balance + view.openAction - view.debt, readOnly, reload }
}
