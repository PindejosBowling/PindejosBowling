// src/utils/data.js — pure data derivation functions (AP-4)
//
// All functions accept data as explicit parameters instead of reading from the
// global `state` object. This makes them composable with Vue's computed() for
// automatic memoization: a computed() that calls one of these functions will
// only recompute when its reactive dependencies (the passed store refs) change.
//
// Usage pattern in a Vue component:
//   import { computed } from 'vue'
//   import { useDataStore } from '../stores/data.js'
//   import { aggregateStandings } from '../utils/data.js'
//   const dataStore = useDataStore()
//   const standings = computed(() => aggregateStandings(dataStore.stats, 'all'))
//
import { SC, AW } from './constants.js'
import { isPresent, combinations } from './helpers.js'

// ---------------------------------------------------------------------------
// LOW-LEVEL UTILITIES
// ---------------------------------------------------------------------------

/**
 * Return filtered stats rows: skip the header row and rows with no player name.
 * This is the base for almost every other derivation function.
 *
 * @param {Array[]|null} stats - raw 2D stats sheet from the API
 * @returns {Array[]}
 */
export function statsRows(stats) {
  return stats ? stats.slice(1).filter(r => r[SC.PLAYER]) : []
}

// ---------------------------------------------------------------------------
// SEASON / WEEK HELPERS
// ---------------------------------------------------------------------------

/**
 * Return a sorted array of all season identifiers present in the stats sheet.
 * @param {Array[]|null} stats
 * @returns {string[]}
 */
export function getSeasons(stats) {
  const s = new Set()
  statsRows(stats).forEach(r => {
    if (r[SC.SEASON] !== '' && r[SC.SEASON] != null) s.add(String(r[SC.SEASON]))
  })
  return Array.from(s).sort()
}

/**
 * Return the current season identifier.
 * Prefers the 'CurrentSeason' setting from the backend; falls back to the
 * most recent season in the stats sheet.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings - raw 2D settings sheet from the API
 * @returns {string}
 */
export function getCurrentSeason(stats, settings) {
  const settingVal = settings
    ? (settings.slice(1).find(r => r[0] === 'CurrentSeason') || [])[1]
    : null
  if (settingVal) return String(settingVal)
  const s = getSeasons(stats)
  return s.length ? s[s.length - 1] : '1'
}

/**
 * Return the most recent season that actually has stats data.
 * Use this for view defaults to avoid landing on an empty new season
 * immediately after End Season runs.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings
 * @returns {string}
 */
export function getDefaultViewSeason(stats, settings) {
  const s = getSeasons(stats)
  return s.length ? s[s.length - 1] : getCurrentSeason(stats, settings)
}

/**
 * Return all week identifiers for a given season, sorted naturally.
 * @param {Array[]|null} stats
 * @param {string|number} season
 * @returns {string[]}
 */
export function getWeeksForSeason(stats, season) {
  const weeks = new Set()
  statsRows(stats).forEach(r => {
    if (String(r[SC.SEASON]) === String(season) && r[SC.WEEK] !== '' && r[SC.WEEK] != null) {
      weeks.add(String(r[SC.WEEK]))
    }
  })
  return Array.from(weeks).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    return a.localeCompare(b)
  })
}

// ---------------------------------------------------------------------------
// STANDINGS
// ---------------------------------------------------------------------------

/**
 * Aggregate per-player season standings from the stats sheet.
 * Pass season='all' to aggregate across all seasons.
 *
 * @param {Array[]|null} stats
 * @param {string|number} season - season number or 'all'
 * @returns {{ name, team, wins, losses, pins, games, weekCount, avg }[]}
 */
export function aggregateStandings(stats, season) {
  const players = {}
  statsRows(stats).forEach(r => {
    if (season !== 'all' && String(r[SC.SEASON]) !== String(season)) return
    if (!isPresent(r[SC.PRESENT])) return
    const name = r[SC.PLAYER]
    if (!players[name]) {
      players[name] = { name, team: r[SC.TEAM], wins: 0, losses: 0, pins: 0, games: 0, weeks: new Set() }
    }
    players[name].wins   += parseInt(r[SC.WINS])   || 0
    players[name].losses += parseInt(r[SC.LOSSES]) || 0
    players[name].pins   += parseInt(r[SC.PINS])   || 0
    players[name].games  += parseInt(r[SC.GAMES])  || 0
    players[name].weeks.add(String(r[SC.WEEK]))
    players[name].team = r[SC.TEAM]
  })
  return Object.values(players).map(p => ({
    ...p,
    avg: p.games ? p.pins / p.games : 0,
    weekCount: p.weeks.size,
  })).sort((a, b) => b.wins - a.wins || b.pins - a.pins)
}

// ---------------------------------------------------------------------------
// PLAYER STATS
// ---------------------------------------------------------------------------

/**
 * Return all stats rows for a given player (present or absent).
 * @param {Array[]|null} stats
 * @param {string} name
 * @returns {Array[]}
 */
export function getAllPlayerWeeks(stats, name) {
  return statsRows(stats).filter(r => r[SC.PLAYER] === name)
}

/**
 * Build a full player profile for the player detail view.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings
 * @param {string} name
 * @param {string|number|null} season - null or 'all' for all seasons
 * @returns {{ name, games, rows, avg, allTimeAvg, seasonAvg, last5Avg,
 *             totalWins, totalLosses, totalGames, highGame }}
 */
export function getPlayerProfile(stats, settings, name, season) {
  let rows = statsRows(stats).filter(r => r[SC.PLAYER] === name)
  if (season && season !== 'all') rows = rows.filter(r => String(r[SC.SEASON]) === String(season))

  const games = []
  rows.forEach(r => {
    const present = isPresent(r[SC.PRESENT])
    const g1 = parseInt(r[SC.G1]) || 0
    const g2 = parseInt(r[SC.G2]) || 0
    const w  = parseInt(r[SC.WINS])   || 0
    const l  = parseInt(r[SC.LOSSES]) || 0
    if (g1 > 0) games.push({ season: r[SC.SEASON], week: r[SC.WEEK], team: r[SC.TEAM], score: g1, gameNum: 1, present, w, l })
    if (g2 > 0) games.push({ season: r[SC.SEASON], week: r[SC.WEEK], team: r[SC.TEAM], score: g2, gameNum: 2, present, w, l })
  })

  const presentGames  = games.filter(g => g.present)
  const allScores     = presentGames.map(g => g.score)
  const avg           = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0
  const last5         = allScores.slice(-5)
  const last5Avg      = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0
  const presentRows   = rows.filter(r => isPresent(r[SC.PRESENT]))
  const totalWins     = presentRows.reduce((a, r) => a + (parseInt(r[SC.WINS])   || 0), 0)
  const totalLosses   = presentRows.reduce((a, r) => a + (parseInt(r[SC.LOSSES]) || 0), 0)
  const totalGames    = presentRows.reduce((a, r) => a + (parseInt(r[SC.GAMES])  || 0), 0)
  const highGame      = allScores.length ? Math.max(...allScores) : 0

  // All-time and current-season averages (always computed regardless of season filter)
  const allTimeRows = statsRows(stats).filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]))
  const ats = []
  allTimeRows.forEach(r => {
    if (r[SC.G1] && parseInt(r[SC.G1]) > 0) ats.push(parseInt(r[SC.G1]))
    if (r[SC.G2] && parseInt(r[SC.G2]) > 0) ats.push(parseInt(r[SC.G2]))
  })
  const allTimeAvg = ats.length ? ats.reduce((a, b) => a + b, 0) / ats.length : 0

  const curSeason = getCurrentSeason(stats, settings)
  const curRows   = allTimeRows.filter(r => String(r[SC.SEASON]) === String(curSeason))
  const cs = []
  curRows.forEach(r => {
    if (r[SC.G1] && parseInt(r[SC.G1]) > 0) cs.push(parseInt(r[SC.G1]))
    if (r[SC.G2] && parseInt(r[SC.G2]) > 0) cs.push(parseInt(r[SC.G2]))
  })
  const seasonAvg = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0

  return { name, games, rows, avg, allTimeAvg, seasonAvg, last5Avg, totalWins, totalLosses, totalGames, highGame }
}

/**
 * Return personal records for a single player.
 * @param {Array[]|null} stats
 * @param {string} name
 * @returns {{ highGame, highSeries, currentStreak, bestStreak, currentStreakType, winRate }}
 */
export function getPersonalRecords(stats, name) {
  const rows = statsRows(stats).filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]))
  const recs = { highGame: 0, highSeries: 0, currentStreak: 0, bestStreak: 0, currentStreakType: '', winRate: 0 }

  const scores = []
  rows.forEach(r => {
    const g1 = parseInt(r[SC.G1]) || 0
    const g2 = parseInt(r[SC.G2]) || 0
    if (g1 > 0) scores.push(g1)
    if (g2 > 0) scores.push(g2)
    if (g1 + g2 > recs.highSeries) recs.highSeries = g1 + g2
  })
  scores.forEach(s => { if (s > recs.highGame) recs.highGame = s })

  let curStreak = 0, curType = '', best = 0
  rows.forEach(r => {
    const w = parseInt(r[SC.WINS])   || 0
    const l = parseInt(r[SC.LOSSES]) || 0
    if (w > l) {
      if (curType === 'W') curStreak++; else { curStreak = 1; curType = 'W' }
    } else if (l > w) {
      if (curType === 'L') curStreak++; else { curStreak = 1; curType = 'L' }
    }
    if (curStreak > best) best = curStreak
  })
  recs.currentStreak    = curStreak
  recs.bestStreak       = best
  recs.currentStreakType = curType
  return recs
}

/**
 * Return a player's current average based on the chosen source.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings
 * @param {string} name
 * @param {'last-played'|'current-season'|'all-time'} source
 * @returns {number}
 */
export function getPlayerCurrentAvg(stats, settings, name, source = 'last-played') {
  if (source === 'last-played') {
    // Use the most recent season the player has data in
    const rows = statsRows(stats).filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]))
    if (!rows.length) return 0
    const seasons   = Array.from(new Set(rows.map(r => String(r[SC.SEASON])))).sort()
    const lastSeason = seasons[seasons.length - 1]
    const lastRows  = rows.filter(r => String(r[SC.SEASON]) === lastSeason)
    const scores    = []
    lastRows.forEach(r => {
      const g1 = parseInt(r[SC.G1]) || 0
      const g2 = parseInt(r[SC.G2]) || 0
      if (g1 > 0) scores.push(g1)
      if (g2 > 0) scores.push(g2)
    })
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  }
  if (source === 'current-season') {
    const cur      = getCurrentSeason(stats, settings)
    const standings = aggregateStandings(stats, cur)
    const p        = standings.find(s => s.name === name)
    return p && p.avg ? p.avg : 0
  }
  // all-time
  const standings = aggregateStandings(stats, 'all')
  const p         = standings.find(s => s.name === name)
  return p && p.avg ? p.avg : 0
}

/**
 * Return the league-wide weighted average for the chosen source.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings
 * @param {'last-played'|'current-season'|'all-time'} source
 * @returns {number}
 */
export function getLeagueAvg(stats, settings, source = 'last-played') {
  let rows
  if (source === 'last-played') {
    // "Last Season" = most recent season excluding the current/active one.
    // Falls back to current if there's no prior season.
    const seasons     = getSeasons(stats)
    if (!seasons.length) return 0
    const cur         = String(getCurrentSeason(stats, settings))
    const priorSeasons = seasons.filter(s => String(s) !== cur)
    const targetSeason = priorSeasons.length
      ? priorSeasons[priorSeasons.length - 1]
      : seasons[seasons.length - 1]
    rows = statsRows(stats).filter(r => String(r[SC.SEASON]) === String(targetSeason) && isPresent(r[SC.PRESENT]))
  } else if (source === 'current-season') {
    const cur = getCurrentSeason(stats, settings)
    rows = statsRows(stats).filter(r => String(r[SC.SEASON]) === String(cur) && isPresent(r[SC.PRESENT]))
  } else {
    // all-time
    rows = statsRows(stats).filter(r => isPresent(r[SC.PRESENT]))
  }
  const totalPins  = rows.reduce((s, r) => s + (parseInt(r[SC.PINS])  || 0), 0)
  const totalGames = rows.reduce((s, r) => s + (parseInt(r[SC.GAMES]) || 0), 0)
  return totalGames ? totalPins / totalGames : 0
}

// ---------------------------------------------------------------------------
// CHAMPIONS
// ---------------------------------------------------------------------------

/**
 * Return true if the given player is a past season champion.
 * @param {Array[]|null} champions - raw champions sheet
 * @param {string} name
 * @returns {boolean}
 */
export function isChampion(champions, name) {
  if (!champions) return false
  for (let i = 1; i < champions.length; i++) {
    if (champions[i][1] === name) return true
  }
  return false
}

/**
 * Return the champion names for a specific season number.
 * @param {Array[]|null} champions
 * @param {number|string} seasonNum
 * @returns {string[]}
 */
export function championsForSeason(champions, seasonNum) {
  if (!champions) return []
  const out = []
  for (let i = 1; i < champions.length; i++) {
    if (parseInt(champions[i][0]) === parseInt(seasonNum)) out.push(champions[i][1])
  }
  return out
}

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

/**
 * Return true if the named player has RSVP'd Out.
 * @param {Array[]|null} rsvp - raw rsvp sheet
 * @param {string} name
 * @returns {boolean}
 */
export function isPlayerOut(rsvp, name) {
  if (!rsvp) return false
  for (let i = 1; i < rsvp.length; i++) {
    if (rsvp[i][0] === name) return rsvp[i][1] === 'Out'
  }
  return false
}

// ---------------------------------------------------------------------------
// MATCHUPS (stats-sheet derived)
// ---------------------------------------------------------------------------

/**
 * Build paired matchup data for a specific season+week from the stats sheet.
 * Returns game-by-game pairings with team rosters and totals.
 *
 * @param {Array[]|null} stats
 * @param {string|number} season
 * @param {string|number} week
 * @returns {{ gameNum, a: { team, opp, players, total }, b: { team, opp, players, total }|null }[]}
 */
export function getMatchupsForWeek(stats, season, week) {
  const rows = statsRows(stats).filter(
    r => String(r[SC.SEASON]) === String(season) && String(r[SC.WEEK]) === String(week)
  )
  if (!rows.length) return []

  const buildGameMap = (gameNum) => {
    const teamRosters = {}
    rows.forEach(r => {
      const team  = r[SC.TEAM]
      const opp   = r[gameNum === 1 ? SC.G1_OPP : SC.G2_OPP]
      const score = parseInt(r[gameNum === 1 ? SC.G1 : SC.G2]) || 0
      if (!team) return
      if (!teamRosters[team]) teamRosters[team] = { team, opp: opp || '', players: [], total: 0 }
      teamRosters[team].players.push({ name: r[SC.PLAYER], score, present: isPresent(r[SC.PRESENT]) })
      teamRosters[team].total += score
      if (opp && !teamRosters[team].opp) teamRosters[team].opp = opp
    })
    return teamRosters
  }

  const buildPairings = (gameNum) => {
    const map    = buildGameMap(gameNum)
    const seen   = new Set()
    const pairings = []
    Object.values(map).forEach(t => {
      if (seen.has(t.team)) return
      const oppData = t.opp ? map[t.opp] : null
      if (oppData && oppData.opp === t.team) {
        seen.add(t.team); seen.add(t.opp)
        pairings.push({ gameNum, a: t, b: oppData })
      } else {
        seen.add(t.team)
        pairings.push({ gameNum, a: t, b: null })
      }
    })
    return pairings
  }

  return [...buildPairings(1), ...buildPairings(2)]
}

// ---------------------------------------------------------------------------
// HEAD-TO-HEAD
// ---------------------------------------------------------------------------

/**
 * Compute head-to-head records between two players across all shared games.
 * Returns both team game outcomes and individual pin-total outcomes.
 *
 * @param {Array[]|null} stats
 * @param {string} p1
 * @param {string} p2
 * @returns {{ teamP1Wins, teamP2Wins, teamTies, pinP1Wins, pinP2Wins, pinTies,
 *             games: { season, week, gameNum, t1Total, t2Total, p1Score, p2Score }[] }}
 */
export function getH2H(stats, p1, p2) {
  const result = { teamP1Wins: 0, teamP2Wins: 0, teamTies: 0, pinP1Wins: 0, pinP2Wins: 0, pinTies: 0, games: [] }

  const allRowsByKey = {}
  statsRows(stats).forEach(r => {
    const key = r[SC.SEASON] + '|' + r[SC.WEEK]
    if (!allRowsByKey[key]) allRowsByKey[key] = []
    allRowsByKey[key].push(r)
  })

  Object.entries(allRowsByKey).forEach(([, rows]) => {
    const r1 = rows.find(r => r[SC.PLAYER] === p1)
    const r2 = rows.find(r => r[SC.PLAYER] === p2)
    if (!r1 || !r2) return

    ;[1, 2].forEach(gNum => {
      const gCol   = gNum === 1 ? SC.G1 : SC.G2
      const oppCol = gNum === 1 ? SC.G1_OPP : SC.G2_OPP
      if (r1[oppCol] === r2[SC.TEAM] && r2[oppCol] === r1[SC.TEAM]) {
        const t1Total = rows.filter(r => r[SC.TEAM] === r1[SC.TEAM]).reduce((s, r) => s + (parseInt(r[gCol]) || 0), 0)
        const t2Total = rows.filter(r => r[SC.TEAM] === r2[SC.TEAM]).reduce((s, r) => s + (parseInt(r[gCol]) || 0), 0)
        const p1Score = parseInt(r1[gCol]) || 0
        const p2Score = parseInt(r2[gCol]) || 0

        if (t1Total > t2Total)      result.teamP1Wins++
        else if (t2Total > t1Total) result.teamP2Wins++
        else                        result.teamTies++

        if (p1Score > p2Score)      result.pinP1Wins++
        else if (p2Score > p1Score) result.pinP2Wins++
        else if (p1Score && p2Score) result.pinTies++

        result.games.push({ season: r1[SC.SEASON], week: r1[SC.WEEK], gameNum: gNum, t1Total, t2Total, p1Score, p2Score })
      }
    })
  })

  return result
}

// ---------------------------------------------------------------------------
// CHEMISTRY
// ---------------------------------------------------------------------------

/**
 * Compute pair/trio chemistry records — win rates for all combinations of
 * players who appeared together on the same team in the same week.
 *
 * @param {Array[]|null} stats
 * @param {2|3} groupSize - 2 for pairs, 3 for trios
 * @returns {{ names: string[], wins, losses, games, weeks, winRate }[]}
 */
export function getChemistry(stats, groupSize) {
  const teamWeeks = {}
  statsRows(stats).forEach(r => {
    if (!isPresent(r[SC.PRESENT])) return
    const key = r[SC.SEASON] + '|' + r[SC.WEEK] + '|' + r[SC.TEAM]
    if (!teamWeeks[key]) teamWeeks[key] = []
    teamWeeks[key].push(r)
  })

  const groups = {}
  Object.values(teamWeeks).forEach(g => {
    if (g.length < groupSize) return
    combinations(g, groupSize).forEach(combo => {
      const names = combo.map(r => r[SC.PLAYER]).sort()
      const key   = names.join('|')
      const rep   = combo[0]
      if (!groups[key]) groups[key] = { names, wins: 0, losses: 0, games: 0, weeks: 0 }
      groups[key].wins   += parseInt(rep[SC.WINS])   || 0
      groups[key].losses += parseInt(rep[SC.LOSSES]) || 0
      groups[key].games  += parseInt(rep[SC.GAMES])  || 0
      groups[key].weeks++
    })
  })

  const minWeeks = groupSize === 2 ? 2 : 1
  return Object.values(groups)
    .filter(p => p.weeks >= minWeeks)
    .map(p => ({ ...p, winRate: p.games ? p.wins / p.games : 0 }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
}

// ---------------------------------------------------------------------------
// LEAGUE RECORDS
// ---------------------------------------------------------------------------

/**
 * Find league-wide records (high game, high series, high team game, high team
 * night, best season average), optionally filtered to a single season.
 *
 * @param {Array[]|null} stats
 * @param {string|number} season - season number or 'all'
 * @returns {{ highGame, highSeries, highTeamGame, highTeamNight, bestSeasonAvg }}
 */
export function getLeagueRecords(stats, season) {
  const filterSeason = season && season !== 'all' ? String(season) : null
  const recs = {
    highGame:      { val: 0, by: '',   when: '' },
    highSeries:    { val: 0, by: '',   when: '' },
    highTeamGame:  { val: 0, team: '', when: '', roster: [] },
    highTeamNight: { val: 0, team: '', when: '', g1Roster: [], g2Roster: [], g1Total: 0, g2Total: 0 },
    bestSeasonAvg: { val: 0, by: '',   when: '' },
  }

  const rows = statsRows(stats).filter(r =>
    isPresent(r[SC.PRESENT]) && (!filterSeason || String(r[SC.SEASON]) === filterSeason)
  )

  rows.forEach(r => {
    const g1     = parseInt(r[SC.G1]) || 0
    const g2     = parseInt(r[SC.G2]) || 0
    const series = g1 + g2
    if (g1 > recs.highGame.val) recs.highGame = { val: g1, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]} G1` }
    if (g2 > recs.highGame.val) recs.highGame = { val: g2, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]} G2` }
    if (series > recs.highSeries.val && g1 && g2) {
      recs.highSeries = { val: series, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]}` }
    }
  })

  const teamGroups = {}
  rows.forEach(r => {
    const key = r[SC.SEASON] + '|' + r[SC.WEEK] + '|' + r[SC.TEAM]
    if (!teamGroups[key]) teamGroups[key] = []
    teamGroups[key].push(r)
  })
  Object.entries(teamGroups).forEach(([key, grows]) => {
    const [s, w, team] = key.split('|')
    const g1Roster = grows.filter(r => parseInt(r[SC.G1])).map(r => ({ name: r[SC.PLAYER], score: parseInt(r[SC.G1]) }))
    const g2Roster = grows.filter(r => parseInt(r[SC.G2])).map(r => ({ name: r[SC.PLAYER], score: parseInt(r[SC.G2]) }))
    const g1Total  = g1Roster.reduce((s, p) => s + p.score, 0)
    const g2Total  = g2Roster.reduce((s, p) => s + p.score, 0)
    const night    = g1Total + g2Total
    if (g1Total > recs.highTeamGame.val) recs.highTeamGame = { val: g1Total, team, when: `S${s} W${w} G1`, roster: g1Roster }
    if (g2Total > recs.highTeamGame.val) recs.highTeamGame = { val: g2Total, team, when: `S${s} W${w} G2`, roster: g2Roster }
    if (night > recs.highTeamNight.val) {
      recs.highTeamNight = { val: night, team, when: `S${s} W${w}`, g1Roster, g2Roster, g1Total, g2Total }
    }
  })

  // Best season average — call aggregateStandings per season
  const seasons = filterSeason ? [filterSeason] : getSeasons(stats)
  seasons.forEach(s => {
    aggregateStandings(stats, s).forEach(p => {
      if (p.avg > recs.bestSeasonAvg.val) recs.bestSeasonAvg = { val: p.avg, by: p.name, when: `S${s}` }
    })
  })

  return recs
}

// ---------------------------------------------------------------------------
// ACTIVE WEEK (live scoring sheet)
// ---------------------------------------------------------------------------

/**
 * Return true if the active week sheet has at least one player row with a name.
 * @param {Array[]|null} active - raw active week sheet
 * @returns {boolean}
 */
export function hasActiveWeek(active) {
  if (!active || active.length < 2) return false
  for (let i = 1; i < active.length; i++) {
    if (active[i] && active[i][AW.NAME]) return true
  }
  return false
}

/**
 * Parse the active week sheet into a structured team map.
 *
 * @param {Array[]|null} active
 * @returns {{ [teamName]: { name, players: { name, slot, g1, g2, g3, isFill }[], opponents: { 1?, 2?, 3? } } }}
 */
export function readActiveWeek(active) {
  const teams = {}
  if (!active) return teams
  for (let i = 1; i < active.length; i++) {
    const r = active[i]
    if (!r || !r[AW.NAME]) continue
    const team = r[AW.TEAM]
    if (!teams[team]) teams[team] = { name: team, players: [], opponents: {} }
    const p = {
      name:   r[AW.NAME],
      slot:   parseInt(r[AW.SLOT]) || 0,
      g1:     r[AW.G1] === '' || r[AW.G1] == null ? '' : (parseInt(r[AW.G1]) || 0),
      g2:     r[AW.G2] === '' || r[AW.G2] == null ? '' : (parseInt(r[AW.G2]) || 0),
      g3:     r[AW.G3] === '' || r[AW.G3] == null ? '' : (parseInt(r[AW.G3]) || 0),
      isFill: r[AW.IS_FILL] === true || r[AW.IS_FILL] === 'TRUE' || r[AW.IS_FILL] === 1,
    }
    teams[team].players.push(p)
    if (r[AW.G1_OPP]) teams[team].opponents[1] = r[AW.G1_OPP]
    if (r[AW.G2_OPP]) teams[team].opponents[2] = r[AW.G2_OPP]
    if (r[AW.G3_OPP]) teams[team].opponents[3] = r[AW.G3_OPP]
  }
  Object.values(teams).forEach(t => t.players.sort((a, b) => a.slot - b.slot))
  return teams
}

// ---------------------------------------------------------------------------
// EXPECTED SCORE HELPERS (used by matchup views)
// ---------------------------------------------------------------------------

/**
 * Return the effective average to use for a player slot in expected-total
 * calculations. Fill placeholders and Out players use the league average
 * (so the team's expected total is realistic). Present players use their own avg.
 *
 * @param {Array[]|null} stats
 * @param {Array[]|null} settings
 * @param {Array[]|null} rsvp
 * @param {string} playerName
 * @param {boolean} isFill
 * @param {number} leagueAvg - pre-computed league avg for this source
 * @returns {number}
 */
export function effectiveAvg(stats, settings, rsvp, playerName, isFill, leagueAvg) {
  if (isFill) return leagueAvg
  if (isPlayerOut(rsvp, playerName)) return leagueAvg
  return getPlayerCurrentAvg(stats, settings, playerName)
}
