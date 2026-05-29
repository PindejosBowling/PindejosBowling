/**
 * Standalone validation script — StandingsScreen data shape
 *
 * Describes the data shapes before and after the GAS→Supabase migration,
 * fetches live data from Supabase, and logs a standings sample.
 *
 * Run from the app/ directory:
 *   source .env.local && npx tsx scripts/validateStandingsData.ts
 *
 * Or with explicit env vars:
 *   EXPO_PUBLIC_SUPABASE_URL=<url> EXPO_PUBLIC_SUPABASE_API_KEY=<key> npx tsx scripts/validateStandingsData.ts
 */

import { createClient } from '@supabase/supabase-js'

// ─── GAS Data Shape (before migration) ────────────────────────────────────────
//
// The Stats sheet is a 2D array of rows. Row 0 is always headers.
// Column indices are defined in src/utils/constants.js as SC.*.
//
// A single data row (SC column indices):
//   [0]  season  – season number (string or number)
//   [1]  week    – week number within the season
//   [2]  player  – player full name
//   [3]  team    – team name ("Team 1" … "Team N")
//   [4]  g1      – Game 1 individual score (0 if absent)
//   [5]  g1_opp  – Game 1 opponent team name
//   [6]  g2      – Game 2 individual score
//   [7]  g2_opp  – Game 2 opponent team name
//   [8]  pins    – g1 + g2 total
//   [9]  wins    – number of team matchups won this week
//   [10] losses  – number of team matchups lost this week
//   [11] games   – wins + losses (always 2 for a standard week)
//   [12] present – boolean / 'TRUE' / 1 / '1'  (absent rows omitted)
//
// aggregateStandings(stats, season) reduces these rows to:
interface GASStandingsRow {
  name: string      // player full name
  team: string      // last known team assignment
  wins: number      // cumulative wins
  losses: number    // cumulative losses
  pins: number      // cumulative total pins
  games: number     // cumulative games bowled (= wins + losses)
  weekCount: number // distinct weeks player was present
  avg: number       // pins / games  (per-game bowling average)
}

// ─── Supabase Raw Query Shapes (after migration) ──────────────────────────────
//
// scores.listForStandings() returns rows from:
//   scores
//     JOIN team_slots ON team_slots.id = scores.team_slot_id   (!inner)
//       JOIN players  ON players.id  = team_slots.player_id    (left)
//       JOIN weeks    ON weeks.id    = team_slots.week_id       (!inner)
//   WHERE weeks.is_archived = true AND scores.score IS NOT NULL
//
interface SupabaseScoreRow {
  game_number: number
  score: number | null        // never null after the filter, but typed from schema
  team_slots: {
    id: string
    player_id: string | null  // null for fill/placeholder slots
    team_number: number       // 1-based team identifier within the week
    is_fill: boolean          // true = placeholder, not a real bowler
    week_id: string           // UUID of the week
    players: {
      id: string
      name: string
    } | null                  // null when player_id is null (fill slot)
    weeks: {
      season_id: number       // FK → seasons.id
      is_archived: boolean    // always true after the filter
    }
  }
}

// gameSchedule.listForArchivedWeeks() returns rows from:
//   game_schedule
//     JOIN weeks ON weeks.id = game_schedule.week_id  (!inner)
//   WHERE weeks.is_archived = true
//
interface SupabaseScheduleRow {
  week_id: string
  game_number: number
  team_a: number   // team_number of first team in this matchup
  team_b: number   // team_number of opposing team
}

// Output of computeStandingsFromSupabase() — same shape as GASStandingsRow
// except `team` is omitted (teams change week-to-week; not meaningful in aggregate)
interface SupabaseStandingsRow {
  playerId: string  // Supabase player UUID (not in GAS output)
  name: string
  wins: number
  losses: number
  pins: number
  games: number
  weekCount: number
  avg: number
}

// ─── Computation ──────────────────────────────────────────────────────────────

function computeStandingsFromSupabase(
  rawScores: SupabaseScoreRow[],
  rawSchedule: SupabaseScheduleRow[],
  seasonId: number | null,  // null = all seasons
): SupabaseStandingsRow[] {
  // Schedule lookup: "weekId|gameNum|teamNum" → opponentTeamNum
  // Keyed per-team so multiple matchups in the same game round don't overwrite each other.
  const scheduleMap = new Map<string, number>()
  for (const row of rawSchedule) {
    scheduleMap.set(`${row.week_id}|${row.game_number}|${row.team_a}`, row.team_b)
    scheduleMap.set(`${row.week_id}|${row.game_number}|${row.team_b}`, row.team_a)
  }

  // Team totals (all players including fill): "weekId|gameNum|teamNum" → total pins
  const teamTotals = new Map<string, number>()
  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.weeks?.is_archived) continue
    if (seasonId !== null && slot.weeks.season_id !== seasonId) continue
    const key = `${slot.week_id}|${row.game_number}|${slot.team_number}`
    teamTotals.set(key, (teamTotals.get(key) ?? 0) + (row.score ?? 0))
  }

  // Per-player aggregation — non-fill players only
  const byPlayer = new Map<string, {
    name: string; wins: number; losses: number
    pins: number; games: number; weeks: Set<string>
  }>()

  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot || slot.is_fill) continue
    const player = slot.players
    if (!player?.id || !player?.name) continue
    if (!slot.weeks?.is_archived) continue
    if (seasonId !== null && slot.weeks.season_id !== seasonId) continue

    const myTeam = slot.team_number
    const oppTeam = scheduleMap.get(`${slot.week_id}|${row.game_number}|${myTeam}`)
    if (oppTeam === undefined) continue

    const myTotal = teamTotals.get(`${slot.week_id}|${row.game_number}|${myTeam}`) ?? 0
    const oppTotal = teamTotals.get(`${slot.week_id}|${row.game_number}|${oppTeam}`) ?? 0

    if (!byPlayer.has(player.id)) {
      byPlayer.set(player.id, { name: player.name, wins: 0, losses: 0, pins: 0, games: 0, weeks: new Set() })
    }
    const p = byPlayer.get(player.id)!
    // Ties count as a loss, matching GAS behavior: `(teamA > teamB) ? w++ : l++`
    p.wins   += myTotal > oppTotal ? 1 : 0
    p.losses += myTotal <= oppTotal ? 1 : 0
    p.pins   += row.score ?? 0
    p.games  += 1
    p.weeks.add(slot.week_id)
  }

  return Array.from(byPlayer.entries())
    .map(([id, p]) => ({
      playerId: id,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      pins: p.pins,
      games: p.games,
      weekCount: p.weeks.size,
      avg: p.games > 0 ? p.pins / p.games : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.pins - a.pins)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_API_KEY
  if (!url || !key) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_API_KEY')
    console.error('Run: source .env.local && npx tsx scripts/validateStandingsData.ts')
    process.exit(1)
  }

  const supabase = createClient(url, key)

  console.log('Fetching standings data from Supabase...\n')

  const [seasonsRes, scoresRes, scheduleRes] = await Promise.all([
    supabase.from('seasons').select('id, number').order('number'),
    supabase
      .from('scores')
      .select(
        'game_number, score,' +
        'team_slots!inner(id, player_id, team_number, is_fill, week_id,' +
          'players(id, name),' +
          'weeks!inner(season_id, is_archived)' +
        ')'
      )
      .eq('team_slots.weeks.is_archived', true)
      .not('score', 'is', null),
    supabase
      .from('game_schedule')
      .select('week_id, game_number, team_a, team_b, weeks!inner(is_archived)')
      .eq('weeks.is_archived', true),
  ])

  if (scoresRes.error) { console.error('scores error:', scoresRes.error); process.exit(1) }
  if (scheduleRes.error) { console.error('schedule error:', scheduleRes.error); process.exit(1) }

  const allSeasons = seasonsRes.data ?? []
  const rawScores = (scoresRes.data ?? []) as SupabaseScoreRow[]
  const rawSchedule = (scheduleRes.data ?? []) as SupabaseScheduleRow[]

  console.log(`Seasons:          ${allSeasons.length}`)
  console.log(`Score rows:       ${rawScores.length}`)
  console.log(`Schedule rows:    ${rawSchedule.length}\n`)

  // Validate all-time standings
  const allTime = computeStandingsFromSupabase(rawScores, rawSchedule, null)
  console.log(`All-time standings (${allTime.length} players):`)
  console.log('─'.repeat(60))
  console.log(' # | Name                       | W–L      | Pins  | Avg')
  console.log('─'.repeat(60))
  allTime.slice(0, 10).forEach((p, i) => {
    const rank = String(i + 1).padStart(2)
    const name = p.name.padEnd(26)
    const wl   = `${p.wins}–${p.losses}`.padEnd(8)
    const pins = String(p.pins).padStart(5)
    const avg  = p.avg.toFixed(1).padStart(5)
    console.log(` ${rank} | ${name} | ${wl} | ${pins} | ${avg}`)
  })
  if (allTime.length > 10) console.log(` ... and ${allTime.length - 10} more`)

  // Validate per-season standings
  for (const season of allSeasons) {
    const rows = computeStandingsFromSupabase(rawScores, rawSchedule, season.id)
    if (!rows.length) continue
    console.log(`\nSeason ${season.number} standings (${rows.length} players, leader: ${rows[0].name} ${rows[0].wins}W/${rows[0].losses}L avg ${rows[0].avg.toFixed(1)})`)
  }

  // Schema shape summary
  console.log('\n─── Output Shape (SupabaseStandingsRow) ───────────────────────')
  if (allTime.length > 0) {
    const sample = allTime[0]
    console.log('Sample row:')
    console.log(JSON.stringify(sample, null, 2))
    console.log('\nExpected GASStandingsRow equivalent:')
    const gasEquiv: Omit<GASStandingsRow, 'team'> = {
      name: sample.name,
      wins: sample.wins, losses: sample.losses,
      pins: sample.pins, games: sample.games,
      weekCount: sample.weekCount, avg: sample.avg,
    }
    console.log(JSON.stringify(gasEquiv, null, 2))
    console.log('\n✓ Shapes match (Supabase adds `playerId`, drops `team`)')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
