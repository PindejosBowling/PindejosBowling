/**
 * Canonical player-average math — the single source of truth for how a player's
 * bowling average is computed across the app (standings, matchup odds, team
 * balancing, player profiles).
 *
 * Policy (locked in with product):
 *   - A game counts toward the average ONLY if it was actually bowled: a real
 *     numeric score greater than 0. Un-bowled games (null / 0 — absent player,
 *     unscored slot) are excluded from BOTH numerator and denominator, so a
 *     missed week never drags a player's average down.
 *   - Fill slots (`is_fill`) and player-less rows never contribute.
 *   - League average is GAMES-WEIGHTED: Σpins / Σgames over every counted row —
 *     NOT the unweighted mean of per-player averages, and NOT diluted by fill or
 *     un-bowled rows.
 *
 * These functions are PURE and uncached — callers wrap them in `useMemo` at the
 * screen/hook level (see AGENTS rule 6). The mirror of this policy on the DB side
 * lives in `sync_over_under_markets_for_week` and `pvp_player_line`.
 */

/** Minimal row shape shared by every `scores.*` query used for averages. */
export interface AverageRow {
  score: number | null | undefined
  team_slots?: {
    player_id?: string | null
    is_fill?: boolean | null
  } | null
}

export interface PlayerAverage {
  pins: number
  games: number
  avg: number
}

export interface AverageAggregate {
  /** playerId → { pins, games, avg } over counted rows only. */
  byPlayer: Map<string, PlayerAverage>
  /** Games-weighted league average across every counted row. */
  leagueAvg: number
}

/**
 * The canonical predicate: does this score count as a bowled game? Import this
 * anywhere that already has its own aggregation loop (e.g. standings, which
 * accumulates wins/losses in the same pass) so the policy lives in one place.
 */
export function countsTowardAverage(score: number | null | undefined): score is number {
  return typeof score === 'number' && score > 0
}

/**
 * Aggregate per-player and games-weighted league averages from raw score rows.
 *
 * @param rows  Raw rows from any `scores.*` query. Rows may already be
 *              pre-filtered by the query (fills/nulls stripped) — the guards
 *              below are idempotent, so passing either shape is safe.
 * @param opts.filter  Optional extra predicate (e.g. season / week-number scoping)
 *              applied on top of the fill/score guards.
 */
export function aggregatePlayerAverages(
  rows: AverageRow[],
  opts: { filter?: (row: AverageRow) => boolean } = {},
): AverageAggregate {
  const byPlayer = new Map<string, PlayerAverage>()
  let leaguePins = 0
  let leagueGames = 0

  for (const row of rows) {
    const slot = row.team_slots
    if (!slot || slot.is_fill) continue
    const pid = slot.player_id
    if (!pid) continue
    if (!countsTowardAverage(row.score)) continue
    if (opts.filter && !opts.filter(row)) continue

    const score = row.score
    const cur = byPlayer.get(pid) ?? { pins: 0, games: 0, avg: 0 }
    cur.pins += score
    cur.games += 1
    byPlayer.set(pid, cur)

    leaguePins += score
    leagueGames += 1
  }

  for (const p of byPlayer.values()) p.avg = p.games > 0 ? p.pins / p.games : 0

  return { byPlayer, leagueAvg: leagueGames > 0 ? leaguePins / leagueGames : 0 }
}

/**
 * The average to actually use for a slot in a projection (matchup odds, expected
 * totals): a fill slot or an RSVP'd-out player falls back to the league average,
 * as does any real player with no bowled history yet.
 */
export function effectiveAverage(
  agg: AverageAggregate,
  playerId: string | null | undefined,
  opts: { isFill?: boolean; isOut?: boolean } = {},
): number {
  if (opts.isFill || opts.isOut || !playerId) return agg.leagueAvg
  return agg.byPlayer.get(playerId)?.avg ?? agg.leagueAvg
}
