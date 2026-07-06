import { seasons, scores, lanetalkImports } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

type PlayerEntry = { name: string; score: number }
type SimpleRecord = { val: number; by: string; when: string }

/** One scorecard frame of a record-holding game, normalized for display
 *  (strike in the right box for frames 1-9, like computeScorecard). */
export type RecordFrame = {
  frame: number
  throws: { display: string; split: boolean }[]
  isStrike: boolean
  isSpare: boolean
  cumulative: number
}

/** One game of a frame-data record, with its per-game stat counts. */
export type RecordFrameGame = {
  gameNum: number
  score: number
  strikes: number
  spares: number
  closed: number
  frames: RecordFrame[]
}

/** A frame-data record: one game for game-scope, the whole night for night-scope. */
export type FrameRecord = SimpleRecord & { games: RecordFrameGame[] }

/** One side of the winning-margin record game. */
export type MarginTeam = { label: string; total: number; roster: PlayerEntry[] }

/** One week of the best-season-avg record holder's season. */
export type SeasonWeek = { weekNum: number; scores: number[]; avg: number }

export interface LeagueRecords {
  highGame: SimpleRecord
  highSeries: SimpleRecord
  highTeamGame: { val: number; team: string; when: string; roster: PlayerEntry[] }
  highTeamNight: { val: number; team: string; when: string; games: { gameNum: number; roster: PlayerEntry[]; total: number }[] }
  bestSeasonAvg: SimpleRecord & { weeks: SeasonWeek[] }
  largestMargin: SimpleRecord & { teams: MarginTeam[] }
  mostStrikesGame: FrameRecord
  mostStrikesNight: FrameRecord
  mostSparesGame: FrameRecord
  mostSparesNight: FrameRecord
  mostClosedGame: FrameRecord
  mostClosedNight: FrameRecord
}

export function computeLeagueRecordsFromSupabase(
  rawScores: any[],
  rawFrames: any[],
  filterSeasonId: string | null,
): LeagueRecords {
  const recs: LeagueRecords = {
    highGame:         { val: 0, by: '', when: '' },
    highSeries:       { val: 0, by: '', when: '' },
    highTeamGame:     { val: 0, team: '', when: '', roster: [] },
    highTeamNight:    { val: 0, team: '', when: '', games: [] },
    bestSeasonAvg:    { val: 0, by: '', when: '', weeks: [] },
    largestMargin:    { val: 0, by: '', when: '', teams: [] },
    mostStrikesGame:  { val: 0, by: '', when: '', games: [] },
    mostStrikesNight: { val: 0, by: '', when: '', games: [] },
    mostSparesGame:   { val: 0, by: '', when: '', games: [] },
    mostSparesNight:  { val: 0, by: '', when: '', games: [] },
    mostClosedGame:   { val: 0, by: '', when: '', games: [] },
    mostClosedNight:  { val: 0, by: '', when: '', games: [] },
  }

  const seriesMap = new Map<string, { name: string; gameScores: Map<number, number>; seasonNum: number; weekNum: number }>()
  const teamGameMap = new Map<string, { team: number; seasonNum: number; weekNum: number; gameNum: number; total: number; roster: PlayerEntry[] }>()
  const teamNightMap = new Map<string, { team: number; seasonNum: number; weekNum: number; total: number; gameRosters: Map<number, { total: number; roster: PlayerEntry[] }> }>()
  const seasonPlayerMap = new Map<string, { name: string; seasonNum: number; pins: number; games: number; weekScores: Map<number, number[]> }>()
  const matchupGameMap = new Map<string, { seasonNum: number; weekNum: number; gameNum: number; teams: Map<string, { team: number; total: number; roster: PlayerEntry[] }> }>()

  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.teams?.weeks?.is_archived) continue
    if (filterSeasonId !== null && slot.teams.weeks.season_id !== filterSeasonId) continue

    const score: number = row.score ?? 0
    const seasonNum: number = slot.teams.weeks.seasons?.number ?? 0
    const weekNum: number = slot.teams.weeks.week_number ?? 0
    const gameNum: number = (row.games as any)?.game_number ?? 0

    if (!slot.is_fill && slot.players?.name) {
      const playerName: string = slot.players.name
      const playerId: string = slot.players.id ?? playerName

      if (score > recs.highGame.val) {
        recs.highGame = { val: score, by: playerName, when: `S${seasonNum} W${weekNum} G${gameNum}` }
      }

      const seriesKey = `${slot.teams.week_id}|${playerId}`
      if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, { name: playerName, gameScores: new Map(), seasonNum, weekNum })
      const se = seriesMap.get(seriesKey)!
      se.gameScores.set(gameNum, score)

      const spKey = `${slot.teams.weeks.season_id}|${playerId}`
      if (!seasonPlayerMap.has(spKey)) seasonPlayerMap.set(spKey, { name: playerName, seasonNum, pins: 0, games: 0, weekScores: new Map() })
      const sp = seasonPlayerMap.get(spKey)!
      sp.pins += score
      sp.games++
      if (!sp.weekScores.has(weekNum)) sp.weekScores.set(weekNum, [])
      sp.weekScores.get(weekNum)!.push(score)
    }

    const teamNumber: number = slot.teams?.team_number ?? 0

    const tgKey = `${slot.teams.week_id}|${gameNum}|${slot.team_id}`
    if (!teamGameMap.has(tgKey)) teamGameMap.set(tgKey, { team: teamNumber, seasonNum, weekNum, gameNum, total: 0, roster: [] })
    const tg = teamGameMap.get(tgKey)!
    tg.total += score
    if (!slot.is_fill && slot.players?.name) tg.roster.push({ name: slot.players.name, score })

    const tnKey = `${slot.teams.week_id}|${slot.team_id}`
    if (!teamNightMap.has(tnKey)) teamNightMap.set(tnKey, { team: teamNumber, seasonNum, weekNum, total: 0, gameRosters: new Map() })
    const tn = teamNightMap.get(tnKey)!
    tn.total += score
    if (!tn.gameRosters.has(gameNum)) tn.gameRosters.set(gameNum, { total: 0, roster: [] })
    const gr = tn.gameRosters.get(gameNum)!
    gr.total += score
    if (!slot.is_fill && slot.players?.name) gr.roster.push({ name: slot.players.name, score })

    // Per-game team totals keyed by the game row, so the two sides of a
    // matchup land in the same bucket for the winning-margin record.
    if (row.game_id) {
      if (!matchupGameMap.has(row.game_id)) matchupGameMap.set(row.game_id, { seasonNum, weekNum, gameNum, teams: new Map() })
      const mg = matchupGameMap.get(row.game_id)!
      if (!mg.teams.has(slot.team_id)) mg.teams.set(slot.team_id, { team: teamNumber, total: 0, roster: [] })
      const side = mg.teams.get(slot.team_id)!
      side.total += score
      if (!slot.is_fill && slot.players?.name) side.roster.push({ name: slot.players.name, score })
    }
  }

  for (const se of seriesMap.values()) {
    if (se.gameScores.size >= 2) {
      const series = Array.from(se.gameScores.values()).reduce((a, b) => a + b, 0)
      if (series > recs.highSeries.val) {
        recs.highSeries = { val: series, by: se.name, when: `S${se.seasonNum} W${se.weekNum}` }
      }
    }
  }

  for (const tg of teamGameMap.values()) {
    if (tg.total > recs.highTeamGame.val) {
      recs.highTeamGame = {
        val: tg.total,
        team: `Team ${tg.team}`,
        when: `S${tg.seasonNum} W${tg.weekNum} G${tg.gameNum}`,
        roster: [...tg.roster].sort((a, b) => b.score - a.score),
      }
    }
  }

  for (const tn of teamNightMap.values()) {
    if (tn.total > recs.highTeamNight.val) {
      const games = Array.from(tn.gameRosters.entries())
        .sort(([a], [b]) => a - b)
        .map(([gameNum, { total, roster }]) => ({
          gameNum,
          total,
          roster: [...roster].sort((a, b) => b.score - a.score),
        }))
      recs.highTeamNight = {
        val: tn.total,
        team: `Team ${tn.team}`,
        when: `S${tn.seasonNum} W${tn.weekNum}`,
        games,
      }
    }
  }

  for (const sp of seasonPlayerMap.values()) {
    if (sp.games > 0) {
      const avg = sp.pins / sp.games
      if (avg > recs.bestSeasonAvg.val) {
        const weeks: SeasonWeek[] = [...sp.weekScores.entries()]
          .sort(([a], [b]) => a - b)
          .map(([weekNum, weekScores]) => ({
            weekNum,
            scores: weekScores,
            avg: weekScores.reduce((x, y) => x + y, 0) / weekScores.length,
          }))
        recs.bestSeasonAvg = { val: avg, by: sp.name, when: `S${sp.seasonNum}`, weeks }
      }
    }
  }

  for (const mg of matchupGameMap.values()) {
    if (mg.teams.size !== 2) continue
    const [a, b] = [...mg.teams.values()]
    const margin = Math.abs(a.total - b.total)
    if (margin > recs.largestMargin.val) {
      const [w, l] = a.total >= b.total ? [a, b] : [b, a]
      recs.largestMargin = {
        val: margin,
        by: `Team ${w.team} over Team ${l.team}`,
        when: `S${mg.seasonNum} W${mg.weekNum} G${mg.gameNum} · ${w.total}–${l.total}`,
        teams: [w, l].map(t => ({
          label: `Team ${t.team}`,
          total: t.total,
          roster: [...t.roster].sort((x, y) => y.score - x.score),
        })),
      }
    }
  }

  // --- Frame-data records (LaneTalk imports: official games, archived weeks) ---

  const frameNightMap = new Map<string, { name: string; seasonNum: number; weekNum: number; strikes: number; spares: number; closed: number; games: RecordFrameGame[] }>()

  for (const row of rawFrames) {
    const week = row.weeks
    if (!week) continue
    if (filterSeasonId !== null && week.season_id !== filterSeasonId) continue
    const name: string = row.players?.name ?? ''
    if (!name) continue
    const seasonNum: number = week.seasons?.number ?? 0
    const weekNum: number = week.week_number ?? 0

    // One count per scoring frame (the 10th counts once), matching the
    // scorecard math in useFrameStatsData. Closed = not open.
    const frames: RecordFrame[] = (row.payload?.frames ?? []).map((f: any): RecordFrame => ({
      frame: f.frame,
      throws: f.frame < 10 && f.is_strike
        ? [{ display: '', split: false }, { display: 'X', split: false }]
        : (f.throws ?? []).map((t: any) => ({ display: t.display ?? '', split: !!t.split })),
      isStrike: !!f.is_strike,
      isSpare: !!f.is_spare,
      cumulative: f.cumulative_score ?? 0,
    }))
    const strikes = frames.filter(f => f.isStrike).length
    const spares = frames.filter(f => f.isSpare).length
    const closed = strikes + spares
    const game: RecordFrameGame = {
      gameNum: row.game_number,
      score: row.score ?? row.payload?.score ?? 0,
      strikes, spares, closed, frames,
    }

    const when = `S${seasonNum} W${weekNum} G${row.game_number}`
    if (strikes > recs.mostStrikesGame.val) recs.mostStrikesGame = { val: strikes, by: name, when, games: [game] }
    if (spares > recs.mostSparesGame.val) recs.mostSparesGame = { val: spares, by: name, when, games: [game] }
    if (closed > recs.mostClosedGame.val) recs.mostClosedGame = { val: closed, by: name, when, games: [game] }

    const nKey = `${row.week_id}|${row.player_id}`
    if (!frameNightMap.has(nKey)) frameNightMap.set(nKey, { name, seasonNum, weekNum, strikes: 0, spares: 0, closed: 0, games: [] })
    const night = frameNightMap.get(nKey)!
    night.strikes += strikes
    night.spares += spares
    night.closed += closed
    night.games.push(game)
  }

  for (const n of frameNightMap.values()) {
    const when = `S${n.seasonNum} W${n.weekNum}`
    const games = [...n.games].sort((a, b) => a.gameNum - b.gameNum)
    if (n.strikes > recs.mostStrikesNight.val) recs.mostStrikesNight = { val: n.strikes, by: n.name, when, games }
    if (n.spares > recs.mostSparesNight.val) recs.mostSparesNight = { val: n.spares, by: n.name, when, games }
    if (n.closed > recs.mostClosedNight.val) recs.mostClosedNight = { val: n.closed, by: n.name, when, games }
  }

  return recs
}

interface LeagueRecordsPayload {
  seasonList: { id: string; number: number }[]
  rawScores: any[]
  rawFrames: any[]
}

const EMPTY: LeagueRecordsPayload = { seasonList: [], rawScores: [], rawFrames: [] }

export function useLeagueRecordsData() {
  const { loading, data, reload } = useAsyncData<LeagueRecordsPayload>(async () => {
    const [seasonsRes, scoresRes, framesRes] = await Promise.all([
      seasons.list(),
      scores.listForLeagueRecords(),
      lanetalkImports.listForLeagueRecords(),
    ])
    return {
      seasonList: (seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })),
      rawScores: scoresRes.data ?? [],
      rawFrames: framesRes.data ?? [],
    }
  }, [], 'useLeagueRecordsData')

  return { loading, ...(data ?? EMPTY), reload }
}
