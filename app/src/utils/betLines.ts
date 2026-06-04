// Shared bet-line helpers: the canonical line-from-average rule and the
// per-player average aggregation used to seed new lines. Centralised here so
// RsvpScreen (RSVP-driven line creation), AdminGenerateTeamsModal (game-3 lines
// added on team gen), and BettingAdminScreen (admin line-value editing) all use
// identical logic instead of diverging copies.

import { seasons as dbSeasons, scores as dbScores } from './supabase/db'

// Default line = floor(avg) + 0.5. A half-pin line can never be matched by an
// integer game score, so a bet on it can never push.
export function lineForAvg(avg: number): number {
  return Math.floor(avg) + 0.5
}

// League-avg fallback when there is no score history at all (sparse early-season).
export const LEAGUE_AVG_FALLBACK = 130

// Which archived scores to average over.
export type AvgScope = 'current' | 'previous' | 'all'

export interface AvgResult {
  avgById: Record<string, number>
  leagueAvg: number
}

// Aggregate score rows (shape: `{ score, team_slots: { player_id } }`) into a
// per-player average plus the league average (mean of player averages).
function aggregate(scoreRows: any[]): AvgResult {
  const byPlayer: Record<string, { pins: number; games: number }> = {}
  for (const row of scoreRows) {
    const pid = row.team_slots?.player_id
    if (!pid) continue
    if (!byPlayer[pid]) byPlayer[pid] = { pins: 0, games: 0 }
    byPlayer[pid].pins += row.score ?? 0
    byPlayer[pid].games += 1
  }
  const avgById: Record<string, number> = Object.fromEntries(
    Object.entries(byPlayer).map(([pid, { pins, games }]) => [pid, games > 0 ? pins / games : 0]),
  )
  const vals = Object.values(avgById)
  const leagueAvg =
    vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : LEAGUE_AVG_FALLBACK
  return { avgById, leagueAvg }
}

// Resolve the season id for the 'current'/'previous' scopes. Previous = the
// started (non-registration) season with the highest number below the current
// one (falls back to the highest-numbered started season otherwise).
async function resolveSeasonId(scope: 'current' | 'previous'): Promise<string | null> {
  const { data: current } = await dbSeasons.getCurrent()
  if (scope === 'current') return current?.id ?? null

  const { data: all } = await dbSeasons.list()
  const started = (all ?? []).filter((s: any) => !s.registration_open)
  if (started.length === 0) return null
  const below = current
    ? started.filter((s: any) => s.number < current.number)
    : started
  const pool = below.length > 0 ? below : started.filter((s: any) => s.id !== current?.id)
  if (pool.length === 0) return null
  return pool.reduce((a: any, b: any) => (b.number > a.number ? b : a)).id
}

// Compute per-player averages for the given scope, fetching the archived,
// non-fill scores it needs from Supabase.
export async function computeAvgById(scope: AvgScope): Promise<AvgResult> {
  let scoreRows: any[] = []
  if (scope === 'all') {
    scoreRows = (await dbScores.listAllArchived()).data ?? []
  } else {
    const seasonId = await resolveSeasonId(scope)
    if (seasonId) scoreRows = (await dbScores.listBySeason(seasonId)).data ?? []
  }
  return aggregate(scoreRows)
}
