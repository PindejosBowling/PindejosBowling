const API = "https://script.google.com/macros/s/AKfycbz8sg1ZRlVaD0tXpN6GRlC1awZYu1_KhD7z5Bc88KjsTNntq1dBzAf8aHGbW0th_Tjhiw/exec";
const SC = { SEASON: 0, WEEK: 1, PLAYER: 2, TEAM: 3, G1: 4, G1_OPP: 5, G2: 6, G2_OPP: 7, PINS: 8, WINS: 9, LOSSES: 10, GAMES: 11, PRESENT: 12 };
// Active Week sheet columns (v6.3 schema: supports up to 3 games per night)
const AW_SEASON = 0, AW_WEEK = 1, AW_TEAM = 2, AW_SLOT = 3, AW_NAME = 4, AW_G1 = 5, AW_G2 = 6, AW_G3 = 7, AW_G1_OPP = 8, AW_G2_OPP = 9, AW_G3_OPP = 10, AW_IS_FILL = 11;

const state = {
  current: null, roster: null, rsvp: null, stats: null, board: null,
  history: null, champions: null, generated: null, settings: null,
  selectedPlayer: null,
  standingsSeason: null, playerSeason: null,
  playerLogMode: 'bowled',
  expandedWeek: null,
  histSeason: null, histWeek: null,
  recordsSeason: 'all',
  chemMode: 'pairs',
  chemExpanded: false,
  moreView: 'home',
  myName: localStorage.getItem('pb_myname') || '',
  pendingRSVP: {},
  pendingScores: {},
  avgDisplay: localStorage.getItem('pb_avgdisplay') || 'last-played',
  matchupsView: 'scores',
  oddsRevealed: false,
  genFillMode: 'League Avg', genAvgSource: 'last-season', genTeams: null,
  genNumTeams: 4, genTeamSize: 3, genFillToSize: false,
  genSwapTarget: null,
  h2hP1: null, h2hP2: null
};

const $ = id => document.getElementById(id);
function initials(name) { if (!name) return '?'; return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(); }
function escapeHtml(s) { if (s == null) return ''; return s.toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
function timeAgo(date) {
  const d = new Date(date); const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 604800) return Math.floor(s/86400) + 'd ago';
  return d.toLocaleDateString();
}
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}
function openModal(html) { $('modal-content').innerHTML = html; $('modal-backdrop').classList.add('active'); }
function closeModal() { $('modal-backdrop').classList.remove('active'); }
async function apiGet(action) { const r = await fetch(`${API}?action=${action}`); return r.json(); }
async function apiPost(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(API, { method: 'POST', body });
      return r.json();
    } catch(e) {
      lastErr = e;
      // Brief backoff before retry (Apps Script sometimes has transient hiccups)
      if (attempt === 0) await new Promise(res => setTimeout(res, 1200));
    }
  }
  throw lastErr || new Error('Network error');
}
function isPresent(v) { return v === true || v === 'TRUE' || v === 1 || v === '1'; }

// CHAMPION TRACKING (Season Champions sheet)
function isChampion(name) {
  if (!state.champions) return false;
  for (let i = 1; i < state.champions.length; i++) {
    if (state.champions[i][1] === name) return true;
  }
  return false;
}
function championsForSeason(seasonNum) {
  if (!state.champions) return [];
  const out = [];
  for (let i = 1; i < state.champions.length; i++) {
    if (parseInt(state.champions[i][0]) === parseInt(seasonNum)) out.push(state.champions[i][1]);
  }
  return out;
}
function nameWithCrown(name) {
  return escapeHtml(name) + (isChampion(name) ? '<span class="champ-crown" title="Past champion">👑</span>' : '');
}

// STATS DERIVATION
function statsRows() { return state.stats ? state.stats.slice(1).filter(r => r[SC.PLAYER]) : []; }
function getSeasons() {
  const s = new Set();
  statsRows().forEach(r => { if (r[SC.SEASON] !== '' && r[SC.SEASON] != null) s.add(String(r[SC.SEASON])); });
  return Array.from(s).sort();
}
function getCurrentSeason() {
  const settingVal = state.settings ? (state.settings.slice(1).find(r => r[0] === 'CurrentSeason') || [])[1] : null;
  if (settingVal) return String(settingVal);
  const s = getSeasons(); return s.length ? s[s.length - 1] : '1';
}
// For view defaults: returns the most recent season that actually has stats.
// Avoids landing users on an empty Season 2 right after End Season.
function getDefaultViewSeason() {
  const s = getSeasons();
  return s.length ? s[s.length - 1] : getCurrentSeason();
}

function aggregateStandings(season) {
  const players = {};
  statsRows().forEach(r => {
    if (season !== 'all' && String(r[SC.SEASON]) !== String(season)) return;
    if (!isPresent(r[SC.PRESENT])) return;
    const name = r[SC.PLAYER];
    if (!players[name]) players[name] = { name, team: r[SC.TEAM], wins: 0, losses: 0, pins: 0, games: 0, weeks: new Set() };
    players[name].wins += parseInt(r[SC.WINS]) || 0;
    players[name].losses += parseInt(r[SC.LOSSES]) || 0;
    players[name].pins += parseInt(r[SC.PINS]) || 0;
    players[name].games += parseInt(r[SC.GAMES]) || 0;
    players[name].weeks.add(String(r[SC.WEEK]));
    players[name].team = r[SC.TEAM];
  });
  return Object.values(players).map(p => ({
    ...p, avg: p.games ? p.pins / p.games : 0, weekCount: p.weeks.size
  })).sort((a, b) => b.wins - a.wins || b.pins - a.pins);
}

function getPlayerProfile(name, season) {
  let rows = statsRows().filter(r => r[SC.PLAYER] === name);
  if (season && season !== 'all') rows = rows.filter(r => String(r[SC.SEASON]) === String(season));

  const games = [];
  rows.forEach(r => {
    const present = isPresent(r[SC.PRESENT]);
    const g1 = parseInt(r[SC.G1]) || 0, g2 = parseInt(r[SC.G2]) || 0;
    const w = parseInt(r[SC.WINS]) || 0, l = parseInt(r[SC.LOSSES]) || 0;
    if (g1 > 0) games.push({ season: r[SC.SEASON], week: r[SC.WEEK], team: r[SC.TEAM], score: g1, gameNum: 1, present, w, l });
    if (g2 > 0) games.push({ season: r[SC.SEASON], week: r[SC.WEEK], team: r[SC.TEAM], score: g2, gameNum: 2, present, w, l });
  });

  const presentGames = games.filter(g => g.present);
  const allScores = presentGames.map(g => g.score);
  const avg = allScores.length ? allScores.reduce((a,b)=>a+b,0) / allScores.length : 0;
  const last5 = allScores.slice(-5);
  const last5Avg = last5.length ? last5.reduce((a,b)=>a+b,0) / last5.length : 0;
  const presentRows = rows.filter(r => isPresent(r[SC.PRESENT]));
  const totalWins = presentRows.reduce((a,r) => a + (parseInt(r[SC.WINS])||0), 0);
  const totalLosses = presentRows.reduce((a,r) => a + (parseInt(r[SC.LOSSES])||0), 0);
  const totalGames = presentRows.reduce((a,r) => a + (parseInt(r[SC.GAMES])||0), 0);
  const highGame = allScores.length ? Math.max(...allScores) : 0;

  // All-time and current-season averages (always computed)
  const allTimeRows = statsRows().filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]));
  const ats = []; allTimeRows.forEach(r => {
    if (r[SC.G1] && parseInt(r[SC.G1]) > 0) ats.push(parseInt(r[SC.G1]));
    if (r[SC.G2] && parseInt(r[SC.G2]) > 0) ats.push(parseInt(r[SC.G2]));
  });
  const allTimeAvg = ats.length ? ats.reduce((a,b)=>a+b,0)/ats.length : 0;

  const curSeason = getCurrentSeason();
  const curRows = allTimeRows.filter(r => String(r[SC.SEASON]) === String(curSeason));
  const cs = []; curRows.forEach(r => {
    if (r[SC.G1] && parseInt(r[SC.G1]) > 0) cs.push(parseInt(r[SC.G1]));
    if (r[SC.G2] && parseInt(r[SC.G2]) > 0) cs.push(parseInt(r[SC.G2]));
  });
  const seasonAvg = cs.length ? cs.reduce((a,b)=>a+b,0)/cs.length : 0;

  return { name, games, rows, avg, allTimeAvg, seasonAvg, last5Avg, totalWins, totalLosses, totalGames, highGame };
}

// Get all weeks where this player has any record (present OR absent)
function getAllPlayerWeeks(name) {
  const out = [];
  statsRows().forEach(r => {
    if (r[SC.PLAYER] === name) out.push(r);
  });
  return out;
}

function getMatchupsForWeek(season, week) {
  const rows = statsRows().filter(r => String(r[SC.SEASON]) === String(season) && String(r[SC.WEEK]) === String(week));
  if (!rows.length) return [];
  const buildGameMap = (gameNum) => {
    const teamRosters = {};
    rows.forEach(r => {
      const team = r[SC.TEAM];
      const opp = r[gameNum === 1 ? SC.G1_OPP : SC.G2_OPP];
      const score = parseInt(r[gameNum === 1 ? SC.G1 : SC.G2]) || 0;
      if (!team) return;
      // Include row even if no opp (so absent players show up); group on team
      if (!teamRosters[team]) teamRosters[team] = { team, opp: opp || '', players: [], total: 0 };
      teamRosters[team].players.push({ name: r[SC.PLAYER], score, present: isPresent(r[SC.PRESENT]) });
      teamRosters[team].total += score;
      if (opp && !teamRosters[team].opp) teamRosters[team].opp = opp;
    });
    return teamRosters;
  };
  const buildPairings = (gameNum) => {
    const map = buildGameMap(gameNum);
    const seen = new Set();
    const pairings = [];
    Object.values(map).forEach(t => {
      if (seen.has(t.team)) return;
      const oppData = t.opp ? map[t.opp] : null;
      if (oppData && oppData.opp === t.team) {
        seen.add(t.team); seen.add(t.opp);
        pairings.push({ gameNum, a: t, b: oppData });
      } else {
        seen.add(t.team);
        pairings.push({ gameNum, a: t, b: null });
      }
    });
    return pairings;
  };
  return [...buildPairings(1), ...buildPairings(2)];
}

function getWeeksForSeason(season) {
  const weeks = new Set();
  statsRows().forEach(r => { if (String(r[SC.SEASON]) === String(season) && r[SC.WEEK] !== '' && r[SC.WEEK] != null) weeks.add(String(r[SC.WEEK])); });
  return Array.from(weeks).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });
}

// HEAD-TO-HEAD with split records
function getH2H(p1, p2) {
  // For each (season, week, gameNum) where these two were on opposing teams, record:
  // - team game outcome (which team won)
  // - individual pin total (who scored more pins)
  const result = { teamP1Wins: 0, teamP2Wins: 0, teamTies: 0, pinP1Wins: 0, pinP2Wins: 0, pinTies: 0, games: [] };

  const allRowsByKey = {};
  statsRows().forEach(r => {
    const key = r[SC.SEASON] + '|' + r[SC.WEEK];
    if (!allRowsByKey[key]) allRowsByKey[key] = [];
    allRowsByKey[key].push(r);
  });

  Object.entries(allRowsByKey).forEach(([key, rows]) => {
    const r1 = rows.find(r => r[SC.PLAYER] === p1);
    const r2 = rows.find(r => r[SC.PLAYER] === p2);
    if (!r1 || !r2) return;

    [1, 2].forEach(gNum => {
      const gCol = gNum === 1 ? SC.G1 : SC.G2;
      const oppCol = gNum === 1 ? SC.G1_OPP : SC.G2_OPP;
      // p1's team played p2's team this game?
      if (r1[oppCol] === r2[SC.TEAM] && r2[oppCol] === r1[SC.TEAM]) {
        const t1Total = rows.filter(r => r[SC.TEAM] === r1[SC.TEAM]).reduce((s, r) => s + (parseInt(r[gCol]) || 0), 0);
        const t2Total = rows.filter(r => r[SC.TEAM] === r2[SC.TEAM]).reduce((s, r) => s + (parseInt(r[gCol]) || 0), 0);
        const p1Score = parseInt(r1[gCol]) || 0;
        const p2Score = parseInt(r2[gCol]) || 0;

        if (t1Total > t2Total) result.teamP1Wins++;
        else if (t2Total > t1Total) result.teamP2Wins++;
        else result.teamTies++;

        if (p1Score > p2Score) result.pinP1Wins++;
        else if (p2Score > p1Score) result.pinP2Wins++;
        else if (p1Score && p2Score) result.pinTies++;

        result.games.push({ season: r1[SC.SEASON], week: r1[SC.WEEK], gameNum: gNum, t1Total, t2Total, p1Score, p2Score });
      }
    });
  });

  return result;
}

// CHEMISTRY — pairs and trios
function getChemistry(groupSize) {
  // Group rows by season+week+team (only present players count)
  const teamWeeks = {};
  statsRows().forEach(r => {
    if (!isPresent(r[SC.PRESENT])) return;
    const key = r[SC.SEASON] + '|' + r[SC.WEEK] + '|' + r[SC.TEAM];
    if (!teamWeeks[key]) teamWeeks[key] = [];
    teamWeeks[key].push(r);
  });

  const groups = {};
  Object.values(teamWeeks).forEach(g => {
    if (g.length < groupSize) return;
    const combos = combinations(g, groupSize);
    combos.forEach(combo => {
      const names = combo.map(r => r[SC.PLAYER]).sort();
      const key = names.join('|');
      // Use one representative for team W/L (all share same team-week record)
      const rep = combo[0];
      if (!groups[key]) groups[key] = { names, wins: 0, losses: 0, games: 0, weeks: 0 };
      groups[key].wins += parseInt(rep[SC.WINS]) || 0;
      groups[key].losses += parseInt(rep[SC.LOSSES]) || 0;
      groups[key].games += parseInt(rep[SC.GAMES]) || 0;
      groups[key].weeks++;
    });
  });

  const minWeeks = groupSize === 2 ? 2 : 1;
  return Object.values(groups)
    .filter(p => p.weeks >= minWeeks)
    .map(p => ({ ...p, winRate: p.games ? p.wins / p.games : 0 }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

function combinations(arr, k) {
  if (k > arr.length) return [];
  if (k === 1) return arr.map(x => [x]);
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    rest.forEach(r => out.push([arr[i], ...r]));
  }
  return out;
}

// LEAGUE RECORDS with season filter
function getLeagueRecords(season) {
  const filterSeason = season && season !== 'all' ? String(season) : null;
  const recs = {
    highGame: { val: 0, by: '', when: '' },
    highSeries: { val: 0, by: '', when: '' },
    highTeamGame: { val: 0, team: '', when: '', roster: [] },
    highTeamNight: { val: 0, team: '', when: '', g1Roster: [], g2Roster: [], g1Total: 0, g2Total: 0 },
    bestSeasonAvg: { val: 0, by: '', when: '' }
  };

  const rows = statsRows().filter(r => isPresent(r[SC.PRESENT]) && (!filterSeason || String(r[SC.SEASON]) === filterSeason));

  rows.forEach(r => {
    const g1 = parseInt(r[SC.G1]) || 0, g2 = parseInt(r[SC.G2]) || 0;
    const series = g1 + g2;
    if (g1 > recs.highGame.val) recs.highGame = { val: g1, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]} G1` };
    if (g2 > recs.highGame.val) recs.highGame = { val: g2, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]} G2` };
    if (series > recs.highSeries.val && g1 && g2) recs.highSeries = { val: series, by: r[SC.PLAYER], when: `S${r[SC.SEASON]} W${r[SC.WEEK]}` };
  });

  const teamGroups = {};
  rows.forEach(r => {
    const key = r[SC.SEASON] + '|' + r[SC.WEEK] + '|' + r[SC.TEAM];
    if (!teamGroups[key]) teamGroups[key] = [];
    teamGroups[key].push(r);
  });
  Object.entries(teamGroups).forEach(([key, grows]) => {
    const [s, w, team] = key.split('|');
    const g1Roster = grows.filter(r => parseInt(r[SC.G1])).map(r => ({ name: r[SC.PLAYER], score: parseInt(r[SC.G1]) }));
    const g2Roster = grows.filter(r => parseInt(r[SC.G2])).map(r => ({ name: r[SC.PLAYER], score: parseInt(r[SC.G2]) }));
    const g1Total = g1Roster.reduce((s, p) => s + p.score, 0);
    const g2Total = g2Roster.reduce((s, p) => s + p.score, 0);
    const night = g1Total + g2Total;
    if (g1Total > recs.highTeamGame.val) recs.highTeamGame = { val: g1Total, team, when: `S${s} W${w} G1`, roster: g1Roster };
    if (g2Total > recs.highTeamGame.val) recs.highTeamGame = { val: g2Total, team, when: `S${s} W${w} G2`, roster: g2Roster };
    if (night > recs.highTeamNight.val) {
      recs.highTeamNight = { val: night, team, when: `S${s} W${w}`, g1Roster, g2Roster, g1Total, g2Total };
    }
  });

  // Best season avg
  const seasons = filterSeason ? [filterSeason] : getSeasons();
  seasons.forEach(s => {
    const standings = aggregateStandings(s);
    standings.forEach(p => {
      if (p.avg > recs.bestSeasonAvg.val) recs.bestSeasonAvg = { val: p.avg, by: p.name, when: `S${s}` };
    });
  });

  return recs;
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tab, opts) {
  opts = opts || {};
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $('section-' + tab).classList.add('active');
  $('nav-' + tab).classList.add('active');
  if (tab === 'more') {
    // Vue now owns #more-content via MoreView.vue Teleport.
    // Reset to home unless the caller passed preserveView (e.g. deep-link from Standings → Player Detail).
    if (!opts.preserveView && window.__resetMoreView) window.__resetMoreView();
  }
  if (tab === 'matchups') renderMatchups();

  // Hide the floating pending-score bar when not on Matchups (preserves staged scores in state)
  const bar = document.getElementById('pending-score-bar');
  if (bar) bar.style.display = (tab === 'matchups') ? 'flex' : 'none';
  if (tab === 'matchups') updatePendingScoreBar();
}

// ============================================================
// MATCHUPS — current week
// ============================================================
function getTeamTotals(d) {
  const sum = (rows, col) => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0);
  return {
    t1g1: sum(d.slice(5,8), 2), t3g1: sum(d.slice(5,8), 6),
    t2g1: sum(d.slice(10,13), 2), t4g1: sum(d.slice(10,13), 6),
    t4g2: sum(d.slice(18,21), 2), t1g2: sum(d.slice(18,21), 6),
    t3g2: sum(d.slice(23,26), 2), t2g2: sum(d.slice(23,26), 6)
  };
}
function getPlayerCurrentAvg(name, sourceOverride) {
  const source = sourceOverride || state.avgDisplay || 'last-played';
  // sources: 'current-season' | 'all-time' | 'last-played'
  if (source === 'last-played') {
    // Use most recent season the player has data in
    const rows = statsRows().filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]));
    if (!rows.length) return 0;
    const seasons = Array.from(new Set(rows.map(r => String(r[SC.SEASON])))).sort();
    const lastSeason = seasons[seasons.length - 1];
    const lastSeasonRows = rows.filter(r => String(r[SC.SEASON]) === lastSeason);
    const scores = [];
    lastSeasonRows.forEach(r => {
      const g1 = parseInt(r[SC.G1]) || 0, g2 = parseInt(r[SC.G2]) || 0;
      if (g1 > 0) scores.push(g1);
      if (g2 > 0) scores.push(g2);
    });
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }
  if (source === 'current-season') {
    const cur = getCurrentSeason();
    const standings = aggregateStandings(cur);
    const p = standings.find(s => s.name === name);
    return p && p.avg ? p.avg : 0;
  }
  // all-time
  const standings = aggregateStandings('all');
  const p = standings.find(s => s.name === name);
  return p && p.avg ? p.avg : 0;
}

function getLeagueAvg(source) {
  source = source || state.avgDisplay || 'last-played';
  // Use weighted avg (total pins / total games) consistently across all sources for apples-to-apples math.
  let rows;
  if (source === 'last-played') {
    // "Last Season" = most recent season EXCLUDING the current/active one.
    // Fall back to current if there's no prior season.
    const seasons = getSeasons();
    if (!seasons.length) return 0;
    const cur = String(getCurrentSeason());
    const priorSeasons = seasons.filter(s => String(s) !== cur);
    const targetSeason = priorSeasons.length ? priorSeasons[priorSeasons.length - 1] : seasons[seasons.length - 1];
    rows = statsRows().filter(r => String(r[SC.SEASON]) === String(targetSeason) && isPresent(r[SC.PRESENT]));
  } else if (source === 'current-season') {
    const cur = getCurrentSeason();
    rows = statsRows().filter(r => String(r[SC.SEASON]) === String(cur) && isPresent(r[SC.PRESENT]));
  } else {
    // all-time
    rows = statsRows().filter(r => isPresent(r[SC.PRESENT]));
  }
  const totalPins = rows.reduce((s, r) => s + (parseInt(r[SC.PINS]) || 0), 0);
  const totalGames = rows.reduce((s, r) => s + (parseInt(r[SC.GAMES]) || 0), 0);
  return totalGames ? totalPins / totalGames : 0;
}
function isPlayerOut(name) {
  if (!state.rsvp) return false;
  for (let i = 1; i < state.rsvp.length; i++) {
    if (state.rsvp[i][0] === name) return state.rsvp[i][1] === 'Out';
  }
  return false;
}

function renderPlayerRow(name, g1Val, g2Val, cellG1, cellG2, mode) {
  if (!name) return '';
  const ini = initials(name);
  const avg = getPlayerCurrentAvg(name);
  const absent = isPlayerOut(name);
  const champ = isChampion(name);

  let scoreCells = '';
  if (mode === 'expected') {
    // Show expected (avg) as static read-only
    const exp = avg > 0 ? Math.round(avg) : '—';
    if (cellG1 && cellG2) {
      scoreCells = `<div class="score-group"><span class="score-label">G1</span><div class="score-display" style="color:var(--muted);">${exp}</div></div>` +
                   `<div class="score-group"><span class="score-label">G2</span><div class="score-display" style="color:var(--muted);">${exp}</div></div>`;
    } else if (cellG1) {
      scoreCells = `<div class="score-group"><span class="score-label">G1</span><div class="score-display" style="color:var(--muted);">${exp}</div></div>`;
    } else if (cellG2) {
      scoreCells = `<div class="score-group"><span class="score-label">G2</span><div class="score-display" style="color:var(--muted);">${exp}</div></div>`;
    }
  } else {
    const buildInput = (cell, val, label) => {
      const initial = val == null || val === '' ? '' : val;
      return `<div class="score-group">
        <span class="score-label">${label}</span>
        <input type="number" inputmode="numeric" pattern="[0-9]*" class="${initial ? 'has-score' : ''}" placeholder="—" value="${initial}" data-cell="${cell}" data-initial="${initial}" oninput="onScoreEdit(this)">
      </div>`;
    };
    const g1 = cellG1 ? buildInput(cellG1, g1Val, 'G1') : '';
    const g2 = cellG2 ? buildInput(cellG2, g2Val, 'G2') : '';
    scoreCells = g1 + g2;
  }

  return `<div class="player-row ${absent ? 'absent' : ''}">
    <div class="player-avatar ${champ ? 'champ' : ''}">${ini}</div>
    <div class="player-info">
      <div class="player-name">${nameWithCrown(name)}${absent ? '<span class="absent-tag">OUT</span>' : ''}</div>
      ${avg > 0 ? `<div class="player-avg">avg ${avg.toFixed(1)}</div>` : ''}
    </div>
    <div class="score-inputs">${scoreCells}</div>
  </div>`;
}

function renderTeamBlock(label, players, winning, total, expectedTotal, mode) {
  const cls = total > 0 ? (winning ? 'total-winning' : 'total-losing') : '';
  const winnerCls = total > 0 && winning ? 'winner' : '';

  let totalRow;
  if (mode === 'expected') {
    totalRow = `<div class="team-total-row">
      <span class="total-label">Expected total</span>
      <div class="total-meta"><span class="total-val total-losing">${expectedTotal}</span></div>
    </div>`;
  } else if (total > 0) {
    totalRow = `<div class="team-total-row">
      <span class="total-label">Team total</span>
      <div class="total-meta"><span class="total-val ${cls}">${total}</span></div>
    </div>`;
  } else {
    totalRow = '';
  }

  return `<div class="team-block ${winnerCls}">
    <div class="team-label ${winnerCls}">${label}</div>
    ${players}
    ${totalRow}
  </div>`;
}

function calcExpectedTotal(d, rowIndices, isCol1) {
  let total = 0;
  rowIndices.forEach(i => {
    const row = d[i]; if (!row) return;
    const name = isCol1 ? row[0] : row[4];
    if (!name) return;
    const avg = getPlayerCurrentAvg(name);
    total += avg > 0 ? Math.round(avg) : 0;
  });
  return total;
}

// Compute spread/moneyline given two avg-based expected totals
function spreadAndML(t1, t2) {
  const diff = t1 - t2;
  const fav = diff > 0 ? 't1' : (diff < 0 ? 't2' : 'tie');
  const spread = Math.abs(diff);
  // Bowling-realistic moneyline. ~5% per pin of edge, with juice.
  // 5 pins ≈ -130, 15 pins ≈ -180, 30 pins ≈ -240, 50+ ≈ -350
  const ml = (d) => {
    const a = Math.abs(d);
    if (a === 0) return { fav: 'EVEN', dog: 'EVEN' };
    if (a < 4) return { fav: '-115', dog: '-105' };
    if (a < 8) return { fav: '-135', dog: '+115' };
    if (a < 14) return { fav: '-160', dog: '+140' };
    if (a < 22) return { fav: '-200', dog: '+170' };
    if (a < 32) return { fav: '-240', dog: '+200' };
    if (a < 45) return { fav: '-300', dog: '+240' };
    return { fav: '-380', dog: '+300' };
  };
  return { fav, spread, ml: ml(diff) };
}

// For expected totals on the matchups screen: returns the projected score for a player.
// Fill placeholders use league avg. Real players who are RSVP=Out also get league avg
// (since they're being filled with a soft fill so the team's expected total is realistic).
// Real present players use their own avg.
function effectiveAvg(playerName, isFill, leagueAvg) {
  if (isFill) return leagueAvg;
  if (isPlayerOut(playerName)) return leagueAvg;
  return getPlayerCurrentAvg(playerName);
}

function hasActiveWeek() {
  if (!state.active || state.active.length < 2) return false;
  // Check if there's at least one non-empty data row (name in slot)
  for (let i = 1; i < state.active.length; i++) {
    if (state.active[i] && state.active[i][AW_NAME]) return true;
  }
  return false;
}

// Read Active Week into a structured form
function readActiveWeek() {
  const teams = {};   // teamName -> { name, players: [{name, slot, g1, g2, g3, isFill}], opponents: {1, 2, 3} }
  if (!state.active) return teams;
  for (let i = 1; i < state.active.length; i++) {
    const r = state.active[i];
    if (!r || !r[AW_NAME]) continue;
    const team = r[AW_TEAM];
    if (!teams[team]) teams[team] = { name: team, players: [], opponents: {} };
    const p = {
      name: r[AW_NAME],
      slot: parseInt(r[AW_SLOT]) || 0,
      g1: r[AW_G1] === '' || r[AW_G1] == null ? '' : (parseInt(r[AW_G1]) || 0),
      g2: r[AW_G2] === '' || r[AW_G2] == null ? '' : (parseInt(r[AW_G2]) || 0),
      g3: r[AW_G3] === '' || r[AW_G3] == null ? '' : (parseInt(r[AW_G3]) || 0),
      isFill: r[AW_IS_FILL] === true || r[AW_IS_FILL] === 'TRUE' || r[AW_IS_FILL] === 1
    };
    teams[team].players.push(p);
    if (r[AW_G1_OPP]) teams[team].opponents[1] = r[AW_G1_OPP];
    if (r[AW_G2_OPP]) teams[team].opponents[2] = r[AW_G2_OPP];
    if (r[AW_G3_OPP]) teams[team].opponents[3] = r[AW_G3_OPP];
  }
  // Sort players by slot within each team
  Object.values(teams).forEach(t => t.players.sort((a, b) => a.slot - b.slot));
  return teams;
}

function renderMatchups() {
  // Branch: if Active Week is populated, use it. Else fall back to legacy Current Week renderer.
  if (hasActiveWeek()) {
    renderActiveMatchups();
  } else {
    renderLegacyMatchups();
  }
}

function renderActiveMatchups() {
  const teams = readActiveWeek();
  const teamNames = Object.keys(teams).sort();  // Team 1, Team 2, Team 3, Team 4
  const mode = state.matchupsView;

  // Compute team total per game (3 possible rounds)
  const teamTotals = { 1: {}, 2: {}, 3: {} };
  teamNames.forEach(t => {
    teamTotals[1][t] = teams[t].players.reduce((s, p) => s + (parseInt(p.g1) || 0), 0);
    teamTotals[2][t] = teams[t].players.reduce((s, p) => s + (parseInt(p.g2) || 0), 0);
    teamTotals[3][t] = teams[t].players.reduce((s, p) => s + (parseInt(p.g3) || 0), 0);
  });

  // Build unique matchup pairings per game from opponent fields
  function buildPairings(gameNum) {
    const seen = new Set();
    const pairings = [];
    teamNames.forEach(t => {
      if (seen.has(t)) return;
      const opp = teams[t].opponents[gameNum];
      if (opp && teams[opp] && teams[opp].opponents[gameNum] === t) {
        seen.add(t); seen.add(opp);
        pairings.push({ a: t, b: opp });
      }
      // For 3+ game configs: don't show "sits out" rows here — only teams with opps actually play this round
    });
    return pairings;
  }

  // Detect how many rounds this week has
  const rounds = [];
  for (let g = 1; g <= 3; g++) {
    const pairs = buildPairings(g);
    if (pairs.length) rounds.push({ num: g, pairs });
  }

  // Set badges
  const settingsW = state.settings ? (state.settings.slice(1).find(r => r[0] === 'CurrentSeason') || [])[1] : null;
  const week = state.active[1] ? state.active[1][AW_WEEK] : '';
  $('week-badge').textContent = typeof week === 'number' || /^\d+$/.test(String(week)) ? `Week ${week}` : (week || 'Week 1');
  $('season-badge').textContent = `Season ${getCurrentSeason()}`;

  let html = `<div class="tab-title">
    <h2>Matchups</h2>
    <span class="pill">This Week</span>
    <select class="view-flip" onchange="state.matchupsView=this.value;renderMatchups();">
      <option value="scores" ${mode==='scores'?'selected':''}>Live</option>
      <option value="expected" ${mode==='expected'?'selected':''}>Expected</option>
    </select>
  </div>`;

  // League avg banner
  const leagueAvg = getLeagueAvg(state.avgDisplay);
  const sourceLabel = state.avgDisplay === 'current-season' ? 'Season Avg'
    : state.avgDisplay === 'all-time' ? 'All-time Avg'
    : 'Last Season Avg';
  html += `<div class="league-avg-banner">
    <div class="league-avg-info">
      <div class="league-avg-label">League ${sourceLabel}</div>
      <div class="league-avg-val">${leagueAvg > 0 ? leagueAvg.toFixed(1) : '—'}</div>
    </div>
    <select class="avg-source-select" onchange="state.avgDisplay=this.value;localStorage.setItem('pb_avgdisplay',this.value);renderMatchups();">
      <option value="last-played" ${state.avgDisplay==='last-played'?'selected':''}>Last Season</option>
      <option value="current-season" ${state.avgDisplay==='current-season'?'selected':''}>This Season</option>
      <option value="all-time" ${state.avgDisplay==='all-time'?'selected':''}>All-time</option>
    </select>
  </div>`;

  function renderTeamBlockActive(teamName, gameNum, isWinner) {
    const t = teams[teamName];
    if (!t) return '';
    const total = teamTotals[gameNum][teamName];
    const playerRows = t.players.map(p => {
      const score = gameNum === 1 ? p.g1 : (gameNum === 2 ? p.g2 : p.g3);
      const avg = p.isFill ? leagueAvg : getPlayerCurrentAvg(p.name);
      const absent = !p.isFill && isPlayerOut(p.name);
      const champ = !p.isFill && isChampion(p.name);
      let cells = '';
      if (mode === 'expected') {
        const exp = avg > 0 ? Math.round(avg) : '—';
        cells = `<div class="score-group"><span class="score-label">G${gameNum}</span><div class="score-display" style="color:var(--muted);">${exp}</div></div>`;
      } else if (p.isFill) {
        // Fill placeholder uses league avg, no input
        cells = `<div class="score-group"><span class="score-label">G${gameNum}</span><div class="score-display" style="color:var(--muted);">${Math.round(leagueAvg)}</div></div>`;
      } else {
        const initial = score === '' || score == null ? '' : score;
        // Absent players have pre-filled league-avg scores; show subtly
        const isAbsentPrefill = absent && initial !== '';
        cells = `<div class="score-group"><span class="score-label">G${gameNum}</span>
          <input type="number" inputmode="numeric" pattern="[0-9]*" class="${initial ? 'has-score' : ''} ${isAbsentPrefill ? 'absent-prefill' : ''}" placeholder="—" value="${initial}" data-team="${escapeHtml(teamName)}" data-slot="${p.slot}" data-game="${gameNum}" data-initial="${initial}" oninput="onActiveScoreEdit(this)" title="${isAbsentPrefill ? 'Pre-filled league avg (player is Out). Type real score to override.' : ''}">
        </div>`;
      }
      const displayName = p.isFill ? `<span style="color:var(--muted);font-style:italic;">League Avg Fill</span>` : nameWithCrown(p.name);
      const avgLine = (avg > 0 && !p.isFill) ? `<div class="player-avg">avg ${avg.toFixed(1)}</div>` : (p.isFill ? `<div class="player-avg">fill</div>` : '');
      return `<div class="player-row ${absent?'absent':''}">
        <div class="player-avatar ${champ?'champ':''}">${p.isFill ? '∅' : initials(p.name)}</div>
        <div class="player-info">
          <div class="player-name">${displayName}${absent?'<span class="absent-tag">OUT</span>':''}${p.isFill?'<span class="fill-tag">FILL</span>':''}</div>
          ${avgLine}
        </div>
        <div class="score-inputs">${cells}</div>
      </div>`;
    }).join('');

    const expectedTotal = t.players.reduce((s, p) => {
      const a = effectiveAvg(p.name, p.isFill, leagueAvg);
      return s + (a > 0 ? Math.round(a) : 0);
    }, 0);

    let totalRow;
    if (mode === 'expected') {
      totalRow = `<div class="team-total-row"><span class="total-label">Expected total</span><div class="total-meta"><span class="total-val total-losing">${expectedTotal}</span></div></div>`;
    } else if (total > 0) {
      const cls = isWinner ? 'total-winning' : 'total-losing';
      totalRow = `<div class="team-total-row"><span class="total-label">Team total</span><div class="total-meta"><span class="total-val ${cls}">${total}</span></div></div>`;
    } else {
      totalRow = '';
    }

    const winnerCls = total > 0 && isWinner ? 'winner' : '';
    return `<div class="team-block ${winnerCls}">
      <div class="team-label ${winnerCls}">${escapeHtml(teamName)}</div>
      ${playerRows}
      ${totalRow}
    </div>`;
  }

  function renderPairing(p, gameNum) {
    const aTotal = teamTotals[gameNum][p.a] || 0;
    const bTotal = p.b ? (teamTotals[gameNum][p.b] || 0) : 0;
    const aWins = aTotal > bTotal;
    const bWins = bTotal > aTotal;
    if (!p.b) {
      return `<div class="matchup">${renderTeamBlockActive(p.a, gameNum, false)}<div style="padding:10px 16px;color:var(--muted);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;text-align:center;font-family:'Barlow Condensed',sans-serif;">— sits out —</div></div>`;
    }
    return `<div class="matchup">
      ${renderTeamBlockActive(p.a, gameNum, aWins)}
      <div class="vs-bar"><div class="vs-left"></div><div class="vs-chip">VS</div><div class="vs-right"></div></div>
      ${renderTeamBlockActive(p.b, gameNum, bWins)}
    </div>`;
  }

  rounds.forEach(rnd => {
    html += `<div class="match-header"><div class="match-title">Game ${rnd.num}</div></div>`;
    rnd.pairs.forEach(p => html += renderPairing(p, rnd.num));
  });

  // Odds easter egg
  if (mode === 'expected') {
    html += `<div class="odds-toggle">
      <span class="odds-toggle-link" onclick="state.oddsRevealed=!state.oddsRevealed;renderMatchups();">${state.oddsRevealed ? '· hide odds ·' : '· · ·'}</span>
    </div>`;
    if (state.oddsRevealed) {
      const expectedTotal = teamName => {
        return teams[teamName].players.reduce((s, p) => {
          const a = effectiveAvg(p.name, p.isFill, leagueAvg);
          return s + (a > 0 ? Math.round(a) : 0);
        }, 0);
      };
      const rosterFor = teamName => teams[teamName].players.map(p => p.isFill ? 'Fill' : p.name);
      let oddsHtml = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-top:8px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--accent2);margin-bottom:10px;">Tonight's Lines</div>`;
      const allPairs = [];
      rounds.forEach(rnd => rnd.pairs.forEach(p => allPairs.push({...p, gameNum: rnd.num})));
      allPairs.forEach(p => {
        if (!p.b) return;
        const e1 = expectedTotal(p.a), e2 = expectedTotal(p.b);
        const odds = spreadAndML(e1, e2);
        oddsHtml += renderOddsBlock(`Game ${p.gameNum} · ${p.a} vs ${p.b}`, odds, p.a, p.b, e1, e2, rosterFor(p.a), rosterFor(p.b));
      });
      oddsHtml += `<div style="font-size:10px;color:var(--muted2);margin-top:10px;font-style:italic;">For entertainment only. Lines are made up.</div></div>`;
      html += oddsHtml;
    }
  }

  $('matchups-content').innerHTML = html;
}

// LEGACY Current Week renderer (kept for backward compat / pre-migration weeks)
function renderLegacyMatchups() {
  const d = state.current; if (!d) return;
  const T = getTeamTotals(d);
  const mode = state.matchupsView;
  const buildRows = (rows, isCol1, gameNum) => rows.map(i => {
    const row = d[i]; if (!row) return '';
    const name = isCol1 ? row[0] : row[4];
    if (!name) return '';
    const score = isCol1 ? row[2] : row[6];
    const cellLetter = isCol1 ? 'C' : 'G';
    const cell = `${cellLetter}${i+1}`;
    return gameNum === 1
      ? renderPlayerRow(name, score, null, cell, null, mode)
      : renderPlayerRow(name, null, score, null, cell, mode);
  }).join('');

  const t1g1 = buildRows([5,6,7], true, 1), t3g1 = buildRows([5,6,7], false, 1);
  const t2g1 = buildRows([10,11,12], true, 1), t4g1 = buildRows([10,11,12], false, 1);
  const t4g2 = buildRows([18,19,20], true, 2), t1g2 = buildRows([18,19,20], false, 2);
  const t3g2 = buildRows([23,24,25], true, 2), t2g2 = buildRows([23,24,25], false, 2);

  const exp_t1g1 = calcExpectedTotal(d, [5,6,7], true);
  const exp_t3g1 = calcExpectedTotal(d, [5,6,7], false);
  const exp_t2g1 = calcExpectedTotal(d, [10,11,12], true);
  const exp_t4g1 = calcExpectedTotal(d, [10,11,12], false);
  const exp_t4g2 = calcExpectedTotal(d, [18,19,20], true);
  const exp_t1g2 = calcExpectedTotal(d, [18,19,20], false);
  const exp_t3g2 = calcExpectedTotal(d, [23,24,25], true);
  const exp_t2g2 = calcExpectedTotal(d, [23,24,25], false);

  const weekVal = d[0] ? d[0][0] : '';

  let html = `<div class="tab-title">
    <h2>Matchups</h2>
    <span class="pill">This Week</span>
    <select class="view-flip" onchange="state.matchupsView=this.value;renderMatchups();">
      <option value="scores" ${mode==='scores'?'selected':''}>Live</option>
      <option value="expected" ${mode==='expected'?'selected':''}>Expected</option>
    </select>
  </div>`;

  // League avg banner with toggle
  const leagueAvg = getLeagueAvg(state.avgDisplay);
  const sourceLabel = state.avgDisplay === 'current-season' ? 'Season Avg'
    : state.avgDisplay === 'all-time' ? 'All-time Avg'
    : 'Last Season Avg';
  html += `<div class="league-avg-banner">
    <div class="league-avg-info">
      <div class="league-avg-label">League ${sourceLabel}</div>
      <div class="league-avg-val">${leagueAvg > 0 ? leagueAvg.toFixed(1) : '—'}</div>
    </div>
    <select class="avg-source-select" onchange="state.avgDisplay=this.value;localStorage.setItem('pb_avgdisplay',this.value);renderMatchups();">
      <option value="last-played" ${state.avgDisplay==='last-played'?'selected':''}>Last Season</option>
      <option value="current-season" ${state.avgDisplay==='current-season'?'selected':''}>This Season</option>
      <option value="all-time" ${state.avgDisplay==='all-time'?'selected':''}>All-time</option>
    </select>
  </div>`;

  html += `<div class="match-header"><div class="match-title">Game 1</div></div>`;
  html += renderMatchupCard(t1g1, t3g1, T.t1g1, T.t3g1, 'Team 1', 'Team 3', exp_t1g1, exp_t3g1, mode);
  html += renderMatchupCard(t2g1, t4g1, T.t2g1, T.t4g1, 'Team 2', 'Team 4', exp_t2g1, exp_t4g1, mode);

  html += `<div class="match-header"><div class="match-title">Game 2</div></div>`;
  html += renderMatchupCard(t4g2, t1g2, T.t4g2, T.t1g2, 'Team 4', 'Team 1', exp_t4g2, exp_t1g2, mode);
  html += renderMatchupCard(t3g2, t2g2, T.t3g2, T.t2g2, 'Team 3', 'Team 2', exp_t3g2, exp_t2g2, mode);

  // Hidden odds toggle (only when in expected mode)
  if (mode === 'expected') {
    html += `<div class="odds-toggle">
      <span class="odds-toggle-link" onclick="state.oddsRevealed=!state.oddsRevealed;renderMatchups();">${state.oddsRevealed ? '· hide odds ·' : '· · ·'}</span>
    </div>`;
    if (state.oddsRevealed) {
      const odds1 = spreadAndML(exp_t1g1, exp_t3g1);
      const odds2 = spreadAndML(exp_t2g1, exp_t4g1);
      const odds3 = spreadAndML(exp_t4g2, exp_t1g2);
      const odds4 = spreadAndML(exp_t3g2, exp_t2g2);
      // Roster lookups from current week
      const t1G1Roster = getCurrentRoster(d, [5,6,7], true);
      const t3G1Roster = getCurrentRoster(d, [5,6,7], false);
      const t2G1Roster = getCurrentRoster(d, [10,11,12], true);
      const t4G1Roster = getCurrentRoster(d, [10,11,12], false);
      const t4G2Roster = getCurrentRoster(d, [18,19,20], true);
      const t1G2Roster = getCurrentRoster(d, [18,19,20], false);
      const t3G2Roster = getCurrentRoster(d, [23,24,25], true);
      const t2G2Roster = getCurrentRoster(d, [23,24,25], false);
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-top:8px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--accent2);margin-bottom:10px;">Tonight's Lines</div>
        ${renderOddsBlock('Game 1 · T1 vs T3', odds1, 'Team 1', 'Team 3', exp_t1g1, exp_t3g1, t1G1Roster, t3G1Roster)}
        ${renderOddsBlock('Game 1 · T2 vs T4', odds2, 'Team 2', 'Team 4', exp_t2g1, exp_t4g1, t2G1Roster, t4G1Roster)}
        ${renderOddsBlock('Game 2 · T4 vs T1', odds3, 'Team 4', 'Team 1', exp_t4g2, exp_t1g2, t4G2Roster, t1G2Roster)}
        ${renderOddsBlock('Game 2 · T3 vs T2', odds4, 'Team 3', 'Team 2', exp_t3g2, exp_t2g2, t3G2Roster, t2G2Roster)}
        <div style="font-size:10px;color:var(--muted2);margin-top:10px;font-style:italic;">For entertainment only. Lines are made up.</div>
      </div>`;
    }
  }

  $('matchups-content').innerHTML = html;
  if (weekVal) {
    const wStr = weekVal.toString();
    $('week-badge').textContent = wStr.toLowerCase().includes('week') ? wStr : `Week ${wStr}`;
  }
  $('season-badge').textContent = `Season ${getCurrentSeason()}`;
}

function renderMatchupCard(t1Players, t2Players, t1Total, t2Total, t1Label, t2Label, exp1, exp2, mode) {
  return `<div class="matchup">
    ${renderTeamBlock(t1Label, t1Players, t1Total > t2Total, t1Total, exp1, mode)}
    <div class="vs-bar"><div class="vs-left"></div><div class="vs-chip">VS</div><div class="vs-right"></div></div>
    ${renderTeamBlock(t2Label, t2Players, t2Total > t1Total, t2Total, exp2, mode)}
  </div>`;
}

// Get player names for a team from the current week sheet
function getCurrentRoster(d, rowIndices, isCol1) {
  const out = [];
  rowIndices.forEach(i => {
    const row = d[i]; if (!row) return;
    const name = isCol1 ? row[0] : row[4];
    if (name) out.push(name);
  });
  return out;
}

function renderOddsBlock(label, odds, t1Name, t2Name, e1, e2, t1Roster, t2Roster) {
  const t1IsFav = odds.fav === 't1';
  const favName = t1IsFav ? t1Name : (odds.fav === 't2' ? t2Name : '');
  const dogName = t1IsFav ? t2Name : (odds.fav === 'tie' ? '' : t1Name);
  const rosterLine = (names) => names.length ? names.join(' · ') : '—';

  if (odds.fav === 'tie') {
    return `<div class="odds-block">
      <div class="odds-block-head">
        <span class="odds-block-label">${label}</span>
        <span class="odds-block-pickem">PICK 'EM (${e1})</span>
      </div>
      <div class="odds-block-teams">
        <div class="odds-team-side"><div class="odds-team-name">${t1Name}</div><div class="odds-roster">${rosterLine(t1Roster)}</div></div>
        <div class="odds-team-side"><div class="odds-team-name">${t2Name}</div><div class="odds-roster">${rosterLine(t2Roster)}</div></div>
      </div>
    </div>`;
  }

  return `<div class="odds-block">
    <div class="odds-block-head">
      <span class="odds-block-label">${label}</span>
      <div class="odds-line-stack">
        <div class="odds-line-row"><span class="odds-prefix">SPREAD</span><span class="odds-chip fav">${favName} -${odds.spread}</span></div>
        <div class="odds-line-row"><span class="odds-prefix">ML</span><span class="odds-chip fav">${favName} ${odds.ml.fav}</span><span class="odds-chip dog">${dogName} ${odds.ml.dog}</span></div>
      </div>
    </div>
    <div class="odds-block-teams">
      <div class="odds-team-side ${t1IsFav?'fav':'dog'}">
        <div class="odds-team-name">${t1Name} ${t1IsFav?'<span class="odds-tag-fav">FAV</span>':''}<span class="odds-team-proj">${e1}</span></div>
        <div class="odds-roster">${rosterLine(t1Roster)}</div>
      </div>
      <div class="odds-team-side ${!t1IsFav?'fav':'dog'}">
        <div class="odds-team-name">${t2Name} ${!t1IsFav?'<span class="odds-tag-fav">FAV</span>':''}<span class="odds-team-proj">${e2}</span></div>
        <div class="odds-roster">${rosterLine(t2Roster)}</div>
      </div>
    </div>
  </div>`;
}

// Score input handlers - show confirm button when changed, save on confirm tap
// SCORE ENTRY - staged batch save model
// User edits inputs freely. Each change gets staged in state.pendingScores.
// A sticky bar at bottom shows total pending and a single "Save all" button.

// Active Week variant: keyed by team+slot+game
function onActiveScoreEdit(input) {
  const team = input.dataset.team;
  const slot = input.dataset.slot;
  const game = input.dataset.game;
  const key = `${team}|${slot}|${game}`;
  const initial = input.dataset.initial || '';
  const current = input.value;

  if (!state.pendingScores) state.pendingScores = {};

  if (current !== initial && current !== '') {
    state.pendingScores[key] = { team, slot: parseInt(slot), gameNum: parseInt(game), score: current };
    input.classList.add('score-pending');
  } else if (current === initial) {
    delete state.pendingScores[key];
    input.classList.remove('score-pending');
  } else if (current === '') {
    // Cleared the input — treat as no change unless initial was also empty
    delete state.pendingScores[key];
    input.classList.remove('score-pending');
  }
  updatePendingScoreBar();
}

// Legacy cell-based variant (Current Week sheet fallback)
function onScoreEdit(input) {
  const cell = input.dataset.cell;
  const initial = input.dataset.initial || '';
  const current = input.value;
  const key = `cell|${cell}`;

  if (!state.pendingScores) state.pendingScores = {};

  if (current !== initial && current !== '') {
    state.pendingScores[key] = { cell, score: current, legacy: true };
    input.classList.add('score-pending');
  } else {
    delete state.pendingScores[key];
    input.classList.remove('score-pending');
  }
  updatePendingScoreBar();
}

function updatePendingScoreBar() {
  const count = state.pendingScores ? Object.keys(state.pendingScores).length : 0;
  let bar = document.getElementById('pending-score-bar');
  if (count === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pending-score-bar';
    bar.className = 'confirm-bar floating';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <div class="confirm-bar-text">${count} unsaved score${count > 1 ? 's' : ''}</div>
    <div class="confirm-bar-actions">
      <button class="btn sm" onclick="discardPendingScores()">Discard</button>
      <button class="btn sm primary" onclick="savePendingScores()">Save All</button>
    </div>`;
}

function discardPendingScores() {
  state.pendingScores = {};
  document.querySelectorAll('input.score-pending').forEach(inp => {
    inp.classList.remove('score-pending');
    inp.value = inp.dataset.initial || '';
  });
  updatePendingScoreBar();
  toast('Discarded', 'success');
}

async function savePendingScores() {
  const pending = state.pendingScores || {};
  const keys = Object.keys(pending);
  if (!keys.length) return;

  // Validate all first
  for (const key of keys) {
    const p = pending[key];
    const n = parseInt(p.score);
    if (isNaN(n) || n < 0 || n > 300) {
      toast(`Invalid score: ${p.score}`, 'error');
      return;
    }
  }

  // Show spinner in bar
  const bar = document.getElementById('pending-score-bar');
  if (bar) {
    bar.classList.add('saving');
    bar.innerHTML = `
      <div class="confirm-bar-text"><span class="bar-spinner"></span> Saving ${keys.length} score${keys.length > 1 ? 's' : ''}...</div>`;
  }

  // Build batch payload
  const batchScores = keys.map(k => {
    const p = pending[k];
    if (p.legacy) return { cell: p.cell, score: p.score, legacy: true };
    return { team: p.team, slot: p.slot, gameNum: p.gameNum, score: p.score };
  });

  try {
    const r = await apiPost('batchUpdateScores', { scores: batchScores });
    if (r.error) { toast(r.error, 'error'); updatePendingScoreBar(); return; }
    // Apply to local state.active / state.current
    keys.forEach(k => {
      const p = pending[k];
      if (!p.legacy && state.active) {
        for (let i = 1; i < state.active.length; i++) {
          const row = state.active[i];
          if (!row) continue;
          if (String(row[AW_TEAM]) === p.team && parseInt(row[AW_SLOT]) === p.slot) {
            const aCol = p.gameNum === 1 ? AW_G1 : (p.gameNum === 2 ? AW_G2 : AW_G3);
            state.active[i][aCol] = parseInt(p.score);
            break;
          }
        }
      } else if (p.legacy && state.current) {
        const m = p.cell.match(/([A-Z]+)(\d+)/);
        if (m) {
          const col = m[1].charCodeAt(0) - 65, row = parseInt(m[2]) - 1;
          if (state.current[row]) state.current[row][col] = parseInt(p.score);
        }
      }
    });
    state.pendingScores = {};
    renderMatchups();
    updatePendingScoreBar();
    const errCount = (r.errors || []).length;
    if (errCount) toast(`${r.updated} saved, ${errCount} failed`, 'error');
    else toast(`${r.updated} saved`, 'success');
  } catch(e) {
    toast('Save failed', 'error');
    if (bar) bar.classList.remove('saving');
    updatePendingScoreBar();
  }
}

// (Legacy per-input confirm functions removed in v6.1 — replaced by staged batch save above.)



// ============================================================
// RSVP
// ============================================================
function renderRSVP() {
  if (!state.roster) return;
  const players = state.roster.slice(1).filter(r => r[0]);
  const rsvpMap = {};
  if (state.rsvp) state.rsvp.slice(1).forEach(r => { if (r[0]) rsvpMap[r[0]] = r[1]; });

  // Apply pending changes for display
  const pending = state.pendingRSVP || {};

  let inCount = 0, outCount = 0, unknown = 0;
  players.forEach(p => {
    const s = pending[p[0]] !== undefined ? pending[p[0]] : (rsvpMap[p[0]] || '');
    if (s === 'In') inCount++; else if (s === 'Out') outCount++; else unknown++;
  });

  let html = `<div class="tab-title"><h2>RSVP</h2></div>`;
  html += `<div class="rsvp-summary">
    <div class="rsvp-stat in"><div class="rsvp-stat-label">In</div><div class="rsvp-stat-val">${inCount}</div></div>
    <div class="rsvp-stat out"><div class="rsvp-stat-label">Out</div><div class="rsvp-stat-val">${outCount}</div></div>
    <div class="rsvp-stat unknown"><div class="rsvp-stat-label">No reply</div><div class="rsvp-stat-val">${unknown}</div></div>
  </div>
  <div class="section-header">This Week<div class="actions"><button class="btn sm danger" onclick="confirmResetRSVP()">Reset</button></div></div>
  <div class="standings-card">`;
  players.forEach(p => {
    const saved = rsvpMap[p[0]] || '';
    const current = pending[p[0]] !== undefined ? pending[p[0]] : saved;
    const isPending = pending[p[0]] !== undefined && pending[p[0]] !== saved;
    html += `<div class="rsvp-row ${isPending ? 'pending' : ''}">
      <div class="rsvp-name">${nameWithCrown(p[0])}${isPending ? '<span class="pending-dot" title="Unsaved"></span>' : ''}</div>
      <div class="rsvp-buttons">
        <button class="rsvp-btn in ${current==='In'?'active':''}" onclick="stageRSVP('${escapeHtml(p[0])}', 'In')">In</button>
        <button class="rsvp-btn out ${current==='Out'?'active':''}" onclick="stageRSVP('${escapeHtml(p[0])}', 'Out')">Out</button>
      </div>
    </div>`;
  });
  html += `</div>`;

  // Pending changes bar
  const pendingCount = Object.keys(pending).filter(name => pending[name] !== (rsvpMap[name] || '')).length;
  if (pendingCount > 0) {
    html += `<div class="confirm-bar">
      <div class="confirm-bar-text">${pendingCount} unsaved change${pendingCount > 1 ? 's' : ''}</div>
      <div class="confirm-bar-actions">
        <button class="btn sm" onclick="discardRSVPChanges()">Discard</button>
        <button class="btn sm primary" onclick="saveRSVPChanges()">Save</button>
      </div>
    </div>`;
  }
  $('rsvp-content').innerHTML = html;
}

function stageRSVP(name, status) {
  if (!state.pendingRSVP) state.pendingRSVP = {};
  // Compare against saved state. If toggling back to saved value, remove from pending.
  const rsvpMap = {};
  if (state.rsvp) state.rsvp.slice(1).forEach(r => { if (r[0]) rsvpMap[r[0]] = r[1]; });
  const saved = rsvpMap[name] || '';

  // If they tap the same button as the current pending/saved value, treat as toggle-off
  const currentPending = state.pendingRSVP[name];
  const current = currentPending !== undefined ? currentPending : saved;
  if (current === status) {
    // Toggle off → empty
    if (saved === '') {
      delete state.pendingRSVP[name];
    } else {
      state.pendingRSVP[name] = '';
    }
  } else {
    if (status === saved) {
      delete state.pendingRSVP[name];
    } else {
      state.pendingRSVP[name] = status;
    }
  }
  renderRSVP();
}

function discardRSVPChanges() {
  state.pendingRSVP = {};
  renderRSVP();
  toast('Discarded', 'success');
}

async function saveRSVPChanges() {
  const pending = state.pendingRSVP || {};
  const rsvpMap = {};
  if (state.rsvp) state.rsvp.slice(1).forEach(r => { if (r[0]) rsvpMap[r[0]] = r[1]; });
  const toSaveNames = Object.keys(pending).filter(name => pending[name] !== (rsvpMap[name] || ''));
  if (!toSaveNames.length) return;

  // Set the bar to saving state with spinner
  setRSVPBarSaving(toSaveNames.length);

  const changes = toSaveNames.map(name => ({ name, status: pending[name] || '' }));

  try {
    const r = await apiPost('batchUpdateRSVP', { changes });
    if (r.error) { toast(r.error, 'error'); renderRSVP(); return; }
    // Apply to local state.rsvp + state.roster
    if (!state.rsvp) state.rsvp = [['Player','Status','Note','Updated']];
    changes.forEach(c => {
      let found = false;
      for (let i = 1; i < state.rsvp.length; i++) {
        if (state.rsvp[i][0] === c.name) { state.rsvp[i][1] = c.status; found = true; break; }
      }
      if (!found) state.rsvp.push([c.name, c.status, '', new Date()]);
      // Mirror into roster Available/Unavailable so Generate Teams sees fresh state immediately
      if (state.roster) {
        for (let i = 1; i < state.roster.length; i++) {
          if (state.roster[i][0] === c.name) {
            state.roster[i][1] = (c.status === 'In') ? 'Available' : 'Unavailable';
            break;
          }
        }
      }
    });
    state.pendingRSVP = {};
    renderRSVP();
    renderMatchups();
    toast(`${r.updated} saved`, 'success');
  } catch(e) {
    toast('Save failed', 'error');
    renderRSVP();
  }
}

function setRSVPBarSaving(count) {
  // Re-render with a saving state on the confirm bar
  const sectionEl = document.getElementById('rsvp-content');
  if (!sectionEl) return;
  let bar = sectionEl.querySelector('.confirm-bar');
  if (bar) {
    bar.classList.add('saving');
    bar.innerHTML = `<div class="confirm-bar-text"><span class="bar-spinner"></span> Saving ${count} RSVP${count > 1 ? 's' : ''}...</div>`;
  }
}

// Legacy single-status setter still exposed in case anything calls it
async function setRSVP(name, status) {
  stageRSVP(name, status);
}

function confirmResetRSVP() {
  openModal(`<div class="modal-title">Reset RSVPs?</div>
    <p style="color:var(--muted);font-size:14px;line-height:1.5;margin-bottom:16px;">
      This clears every RSVP for the upcoming week.
    </p>
    <div class="btn-row">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn danger" onclick="doResetRSVP()">Reset All</button>
    </div>`);
}
async function doResetRSVP() {
  closeModal();
  toast('Resetting...');
  try {
    await apiPost('resetRSVP');
    state.rsvp = [['Player','Status','Note','Updated']];
    if (state.roster) for (let i = 1; i < state.roster.length; i++) if (state.roster[i][0]) state.roster[i][1] = 'Unavailable';
    renderRSVP(); renderMatchups();
    toast('RSVPs reset', 'success');
  } catch(e) { toast('Reset failed', 'error'); }
}

// ============================================================
// STANDINGS
// ============================================================
function renderStandings() {
  const seasons = getSeasons();
  if (state.standingsSeason === null) state.standingsSeason = getDefaultViewSeason();

  let html = `<div class="tab-title"><h2>Standings</h2></div>`;
  html += `<div class="filter-bar">
    <select onchange="state.standingsSeason=this.value;renderStandings();">
      ${seasons.map(s => `<option value="${s}" ${state.standingsSeason === s ? 'selected' : ''}>Season ${s}</option>`).join('')}
      <option value="all" ${state.standingsSeason === 'all' ? 'selected' : ''}>All-time</option>
    </select>
  </div>`;

  const rows = aggregateStandings(state.standingsSeason);
  if (!rows.length) {
    html += `<div class="empty-state">No data for this season yet.</div>`;
    $('standings-content').innerHTML = html;
    return;
  }

  html += `<div class="standings-card">
    <div class="standings-header"><span>#</span><span>Bowler</span><span>W—L</span><span>Pins</span><span>Avg</span></div>`;
  rows.forEach((r, i) => {
    const rank = i + 1;
    html += `<div class="standing-row ${rank===1?'s-rank-1':''}" onclick="showPlayerDetail('${escapeHtml(r.name)}')">
      <div class="s-rank ${rank<=3?'top':''}">${rank}</div>
      <div><div class="s-name">${nameWithCrown(r.name)}</div>${r.team ? `<div class="s-team">${escapeHtml(r.team)}</div>` : ''}</div>
      <div class="s-wl">${r.wins}—${r.losses}</div>
      <div class="s-pins">${r.pins || '—'}</div>
      <div class="s-avg">${r.avg > 0 ? r.avg.toFixed(1) : '—'}</div>
    </div>`;
  });
  html += `</div>`;
  $('standings-content').innerHTML = html;
}

function showPlayerDetail(name) {
  state.selectedPlayer = name;
  state.moreView = 'player-detail';
  state.playerSeason = 'all';
  state.playerLogMode = 'bowled';
  state.expandedWeek = null;
  switchTab('more', { preserveView: true });
}

// ============================================================
// MATCH HISTORY
// ============================================================
function renderMatchHistory() {
  const seasons = getSeasons();
  if (!state.histSeason) state.histSeason = getDefaultViewSeason();
  const weeks = getWeeksForSeason(state.histSeason);
  if (!state.histWeek || !weeks.includes(state.histWeek)) state.histWeek = weeks[weeks.length - 1] || null;

  let html = `<div class="tab-title"><h2>Match History</h2></div>`;
  html += `<div class="filter-bar">
    <select onchange="state.histSeason=this.value;state.histWeek=null;renderMatchHistory();">
      ${seasons.map(s => `<option value="${s}" ${state.histSeason === s ? 'selected' : ''}>Season ${s}</option>`).join('')}
    </select>
    <select onchange="state.histWeek=this.value;renderMatchHistory();">
      ${weeks.map(w => {
        const isPlayoff = isNaN(parseInt(w));
        return `<option value="${w}" ${state.histWeek === w ? 'selected' : ''}>${isPlayoff ? w : 'Week ' + w}</option>`;
      }).join('')}
    </select>
  </div>`;

  if (!weeks.length) {
    html += `<div class="empty-state">No data for this season.</div>`;
    $('history-content').innerHTML = html;
    return;
  }

  const matchups = getMatchupsForWeek(state.histSeason, state.histWeek);
  if (!matchups.length) {
    html += `<div class="empty-state">No data for this week.</div>`;
    $('history-content').innerHTML = html;
    return;
  }
  const game1 = matchups.filter(m => m.gameNum === 1);
  const game2 = matchups.filter(m => m.gameNum === 2);

  if (game1.length) {
    html += `<div class="match-header"><div class="match-title">Game 1</div></div>`;
    game1.forEach(m => html += renderHistoricalMatchup(m));
  }
  if (game2.length) {
    html += `<div class="match-header"><div class="match-title">Game 2</div></div>`;
    game2.forEach(m => html += renderHistoricalMatchup(m));
  }
  $('history-content').innerHTML = html;
}

function renderHistoricalMatchup(m) {
  const a = m.a, b = m.b;
  if (!b) return `<div class="matchup">${renderHistoricalTeamBlock(a, true)}</div>`;
  const aWin = a.total >= b.total;
  return `<div class="matchup">
    ${renderHistoricalTeamBlock(a, aWin)}
    <div class="vs-bar"><div class="vs-left"></div><div class="vs-chip">VS</div><div class="vs-right"></div></div>
    ${renderHistoricalTeamBlock(b, !aWin)}
  </div>`;
}

function renderHistoricalTeamBlock(t, winning) {
  const cls = winning ? 'winner' : '';
  return `<div class="team-block ${cls}">
    <div class="team-label ${cls}">${escapeHtml(t.team)}</div>
    ${t.players.map(p => `
      <div class="player-row ${!p.present ? 'absent' : ''}">
        <div class="player-avatar ${isChampion(p.name) ? 'champ' : ''}">${initials(p.name)}</div>
        <div class="player-info"><div class="player-name">${nameWithCrown(p.name)}${!p.present ? '<span class="absent-tag">OUT</span>' : ''}</div></div>
        <div class="score-inputs"><div class="score-group"><span class="score-label">Score</span>
          <div class="score-display" style="color:${p.score?'var(--text)':'var(--muted)'};">${p.score || '—'}</div>
        </div></div>
      </div>`).join('')}
    <div class="team-total-row"><span class="total-label">Team total</span><div class="total-meta"><span class="total-val ${winning ? 'total-winning' : 'total-losing'}">${t.total}</span></div></div>
  </div>`;
}

// ============================================================
// MORE
// ============================================================
function renderMore() {
  if (state.moreView === 'player-list') return renderPlayerList();
  if (state.moreView === 'player-detail') return renderPlayerDetail();
  if (state.moreView === 'season-history') return renderSeasonHistoryView();
  if (state.moreView === 'records') return renderLeagueRecordsView();
  if (state.moreView === 'h2h') return renderH2HView();
  if (state.moreView === 'chemistry') return renderChemistryView();
  if (state.moreView === 'board') return renderBoard();
  if (state.moreView === 'playoffs') return renderPlayoffsStub();

  let html = `<div class="tab-title"><h2>More</h2></div>`;
  html += `<div class="section-header">League Tools</div>
    <div class="more-grid">
      <div class="more-tile" onclick="state.moreView='player-list';renderMore();"><div class="more-tile-icon">👤</div><div class="more-tile-label">Players</div></div>
      <div class="more-tile" onclick="state.moreView='records';renderMore();"><div class="more-tile-icon">🏅</div><div class="more-tile-label">League Records</div></div>
      <div class="more-tile" onclick="state.moreView='h2h';renderMore();"><div class="more-tile-icon">⚔️</div><div class="more-tile-label">Head to Head</div></div>
      <div class="more-tile" onclick="state.moreView='chemistry';renderMore();"><div class="more-tile-icon">🧪</div><div class="more-tile-label">Team Chemistry</div></div>
      <div class="more-tile" onclick="state.moreView='season-history';renderMore();"><div class="more-tile-icon">🏆</div><div class="more-tile-label">Past Seasons</div></div>
      <div class="more-tile" onclick="state.moreView='board';renderMore();"><div class="more-tile-icon">💬</div><div class="more-tile-label">Trash Board</div></div>
    </div>
    <div class="section-header">League Admin</div>
    <div class="more-grid">
      <div class="more-tile" onclick="openGenerate()"><div class="more-tile-icon">⚖️</div><div class="more-tile-label">Generate Teams</div></div>
      <div class="more-tile" onclick="openAddPlayer()"><div class="more-tile-icon">➕</div><div class="more-tile-label">Add Player</div></div>
      <div class="more-tile" onclick="confirmArchive()"><div class="more-tile-icon">📦</div><div class="more-tile-label">Archive & Advance</div></div>
      <div class="more-tile" onclick="openEndSeason()"><div class="more-tile-icon">🥇</div><div class="more-tile-label">End Season</div></div>
      <div class="more-tile" onclick="state.moreView='playoffs';renderMore();"><div class="more-tile-icon">🏁</div><div class="more-tile-label">Playoffs</div><div class="more-tile-coming">Coming</div></div>
    </div>`;
  $('more-content').innerHTML = html;
}

function backToMore() {
  state.moreView = 'home'; state.selectedPlayer = null;
  state.h2hP1 = null; state.h2hP2 = null;
  renderMore();
}

// PLAYOFFS STUB
function renderPlayoffsStub() {
  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Playoffs</div><div class="player-detail-team">Coming soon</div></div></div>
    <div class="record-card">
      <div class="record-card-head">
        <div class="record-icon">🏁</div>
        <div class="record-info">
          <div class="record-label">Format</div>
          <div class="record-value">Top 4 seeds + snake draft</div>
          <div class="record-detail">Seeds → 1, 2, 3, 4, 4, 3, 2, 1 picking remaining players</div>
        </div>
      </div>
    </div>
    <div class="record-card"><div class="record-card-head"><div class="record-icon">🏆</div><div class="record-info">
      <div class="record-label">Round 1</div>
      <div class="record-value">Top two scoring teams advance</div>
      <div class="record-detail">All 4 playoff teams play; cumulative pins decide who moves on</div>
    </div></div></div>
    <div class="record-card"><div class="record-card-head"><div class="record-icon">🥇</div><div class="record-info">
      <div class="record-label">Finals</div>
      <div class="record-value">Top 2 head-to-head for championship; bottom 2 for 3rd</div>
      <div class="record-detail">Higher pin total wins each game</div>
    </div></div></div>
    <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-top:16px;text-align:center;">
      The playoff hub will let you set seeds, run the snake draft on this screen, and score the playoff week.<br><br>
      For now, run playoffs manually using Match History (will record to the same Weekly Scores sheet).
    </p>`;
  $('more-content').innerHTML = html;
}

// PLAYER LIST
function renderPlayerList() {
  const playerNames = Array.from(new Set(statsRows().map(r => r[SC.PLAYER]))).filter(Boolean);
  if (state.roster) {
    state.roster.slice(1).forEach(r => {
      if (r[0] && !playerNames.includes(r[0])) playerNames.push(r[0]);
    });
  }
  playerNames.sort();

  let html = `<div class="section-header">
    <button class="btn sm" onclick="backToMore()">← Back</button>
    <span class="right-text">Players</span>
  </div>
  <input type="text" class="player-search" placeholder="Search bowlers..." oninput="filterPlayerList(this.value)" id="player-search-input">
  <div id="player-list-results">`;

  playerNames.forEach(name => {
    const profile = getPlayerProfile(name, 'all');
    html += `<div class="player-card" data-name="${escapeHtml(name).toLowerCase()}" onclick="showPlayerDetail('${escapeHtml(name)}')">
      <div class="player-avatar ${isChampion(name) ? 'champ' : ''}">${initials(name)}</div>
      <div class="player-card-info">
        <div class="player-card-name">${nameWithCrown(name)}</div>
        <div class="player-card-stats">${profile.totalGames} games · ${profile.totalWins}W ${profile.totalLosses}L</div>
      </div>
      <div class="player-card-avg">${profile.avg > 0 ? profile.avg.toFixed(1) : '—'}</div>
    </div>`;
  });
  html += `</div>`;
  $('more-content').innerHTML = html;
}

function filterPlayerList(q) {
  const ql = q.toLowerCase();
  document.querySelectorAll('#player-list-results .player-card').forEach(c => {
    c.style.display = c.dataset.name.includes(ql) ? '' : 'none';
  });
}

// PLAYER DETAIL
function renderPlayerDetail() {
  const name = state.selectedPlayer; if (!name) { state.moreView = 'home'; return renderMore(); }
  const seasons = getSeasons();
  if (!state.playerSeason) state.playerSeason = 'all';
  const profile = getPlayerProfile(name, state.playerSeason);

  let html = `<div class="player-detail-header">
    <button class="back-btn" onclick="state.moreView='player-list';renderMore();">←</button>
    <div><div class="player-detail-name">${nameWithCrown(name)}</div>${profile.rows.length && profile.rows[profile.rows.length-1][SC.TEAM] ? `<div class="player-detail-team">${escapeHtml(profile.rows[profile.rows.length-1][SC.TEAM])}</div>` : ''}</div>
  </div>`;

  html += `<div class="filter-bar">
    <select onchange="state.playerSeason=this.value;renderPlayerDetail();">
      <option value="all" ${state.playerSeason === 'all' ? 'selected' : ''}>All-time</option>
      ${seasons.map(s => `<option value="${s}" ${state.playerSeason === s ? 'selected' : ''}>Season ${s}</option>`).join('')}
    </select>
  </div>`;

  html += `<div class="stat-grid">
    <div class="stat-tile"><div class="stat-tile-label">Avg</div><div class="stat-tile-val">${profile.avg > 0 ? profile.avg.toFixed(1) : '—'}</div></div>
    <div class="stat-tile"><div class="stat-tile-label">High Game</div><div class="stat-tile-val">${profile.highGame || '—'}</div></div>
    <div class="stat-tile"><div class="stat-tile-label">W—L</div><div class="stat-tile-val">${profile.totalWins}–${profile.totalLosses}</div></div>
    <div class="stat-tile"><div class="stat-tile-label">Last 5 Avg</div><div class="stat-tile-val">${profile.last5Avg > 0 ? profile.last5Avg.toFixed(1) : '—'}</div></div>
    <div class="stat-tile"><div class="stat-tile-label">Season Avg</div><div class="stat-tile-val">${profile.seasonAvg > 0 ? profile.seasonAvg.toFixed(1) : '—'}</div></div>
    <div class="stat-tile"><div class="stat-tile-label">Games</div><div class="stat-tile-val">${profile.totalGames}</div></div>
  </div>`;

  // Personal records
  const pRec = getPersonalRecords(name);
  html += `<div class="section-header">Personal Records</div>
  <div class="record-card"><div class="record-card-head"><div class="record-icon">🎳</div><div class="record-info"><div class="record-label">High Game</div><div class="record-value">${pRec.highGame || '—'}</div></div></div></div>
  <div class="record-card"><div class="record-card-head"><div class="record-icon">📈</div><div class="record-info"><div class="record-label">High Series (G1+G2)</div><div class="record-value">${pRec.highSeries || '—'}</div></div></div></div>
  <div class="record-card"><div class="record-card-head"><div class="record-icon">🔥</div><div class="record-info"><div class="record-label">Best Streak</div><div class="record-value">${pRec.bestStreak} ${pRec.bestStreak === 1 ? 'night' : 'nights'}</div>${pRec.currentStreak > 0 ? `<div class="record-detail">Current: ${pRec.currentStreak} ${pRec.currentStreakType === 'W' ? 'win' : 'loss'}${pRec.currentStreak > 1 ? 'es' : ''}</div>` : ''}</div></div></div>`;

  // Score chart
  if (profile.games.length) {
    html += `<div class="chart-card"><div class="chart-title">Score Trend</div><div class="chart-wrap"><canvas id="player-chart"></canvas></div></div>`;
  }

  // Game log toggle
  html += `<div class="section-header">Game Log
    <div class="actions">
      <div class="toggle-group" style="padding:2px;">
        <button class="toggle-btn ${state.playerLogMode === 'bowled' ? 'active' : ''}" onclick="state.playerLogMode='bowled';renderPlayerDetail();" style="font-size:10px;padding:5px 8px;">Bowled</button>
        <button class="toggle-btn ${state.playerLogMode === 'all' ? 'active' : ''}" onclick="state.playerLogMode='all';renderPlayerDetail();" style="font-size:10px;padding:5px 8px;">All Weeks</button>
      </div>
    </div>
  </div>`;

  // Build week-grouped log
  let allWeeklyRows = profile.rows;
  if (state.playerSeason === 'all') {
    allWeeklyRows = statsRows().filter(r => r[SC.PLAYER] === name);
  } else {
    allWeeklyRows = statsRows().filter(r => r[SC.PLAYER] === name && String(r[SC.SEASON]) === String(state.playerSeason));
  }

  // One row per week for this player
  let weekRows = [];
  allWeeklyRows.forEach(r => {
    const present = isPresent(r[SC.PRESENT]);
    if (state.playerLogMode === 'bowled' && !present) return;
    const g1 = parseInt(r[SC.G1]) || 0, g2 = parseInt(r[SC.G2]) || 0;
    const w = parseInt(r[SC.WINS]) || 0, l = parseInt(r[SC.LOSSES]) || 0;
    weekRows.push({
      season: r[SC.SEASON], week: r[SC.WEEK], team: r[SC.TEAM],
      g1, g2, w, l, present
    });
  });

  if (weekRows.length) {
    // Sort newest first (descending season then week)
    weekRows.sort((a, b) => {
      const sa = parseInt(a.season) || 0, sb = parseInt(b.season) || 0;
      if (sa !== sb) return sb - sa;
      const wa = parseInt(a.week) || 0, wb = parseInt(b.week) || 0;
      return wb - wa;
    });

    html += `<div class="score-history-table">
      <div class="score-history-row head week-grouped"><span>Week</span><span>Team</span><span>G1</span><span>G2</span><span>W—L</span><span></span></div>`;
    weekRows.forEach(r => {
      const expandKey = r.season + '|' + r.week;
      const expanded = state.expandedWeek === expandKey;
      const wlText = (r.w || r.l) ? `${r.w}—${r.l}` : '—';
      const wlCls = r.w > r.l ? 'win' : (r.l > r.w ? 'loss' : '');
      const weekLabel = isNaN(parseInt(r.week)) ? r.week : `S${r.season}W${r.week}`;
      if (!r.present) {
        html += `<div class="score-history-row clickable week-grouped" onclick="toggleWeekExpand('${escapeHtml(expandKey)}')">
          <span class="sh-week">${escapeHtml(weekLabel)}</span>
          <span class="sh-team">${escapeHtml(r.team || '')}</span>
          <span class="sh-out" style="grid-column: 3 / 6;">absent</span>
          <span class="sh-expand-icon">${expanded ? '▾' : '▸'}</span>
        </div>`;
      } else {
        html += `<div class="score-history-row clickable week-grouped" onclick="toggleWeekExpand('${escapeHtml(expandKey)}')">
          <span class="sh-week">${escapeHtml(weekLabel)}</span>
          <span class="sh-team">${escapeHtml(r.team || '')}</span>
          <span style="color:${r.g1?'var(--accent)':'var(--muted)'};">${r.g1 || '—'}</span>
          <span style="color:${r.g2?'var(--accent)':'var(--muted)'};">${r.g2 || '—'}</span>
          <span class="sh-record ${wlCls}">${wlText}</span>
          <span class="sh-expand-icon">${expanded ? '▾' : '▸'}</span>
        </div>`;
      }
      if (expanded) {
        html += `<div class="week-expand">${renderExpandedWeekForPlayer(r.season, r.week, name, r.team)}</div>`;
      }
    });
    html += `</div>`;
  } else {
    html += `<div class="empty-state">No games yet.</div>`;
  }

  $('more-content').innerHTML = html;

  if (profile.games.length) drawPlayerChart(profile);
}

// Toggle expandable week view in player game log
function toggleWeekExpand(key) {
  state.expandedWeek = state.expandedWeek === key ? null : key;
  renderPlayerDetail();
}

// Render the full week's matchup in the same style as Match History
function renderExpandedWeek(season, week) {
  const matchups = getMatchupsForWeek(season, week);
  if (!matchups.length) return `<div class="empty-state" style="padding:16px;">No matchup data for this week.</div>`;
  const game1 = matchups.filter(m => m.gameNum === 1);
  const game2 = matchups.filter(m => m.gameNum === 2);
  let out = '<div class="week-expand-inner">';
  if (game1.length) {
    out += `<div class="match-header" style="margin:8px 0 8px;"><div class="match-title" style="font-size:16px;">Game 1</div></div>`;
    game1.forEach(m => out += renderHistoricalMatchup(m));
  }
  if (game2.length) {
    out += `<div class="match-header" style="margin:8px 0 8px;"><div class="match-title" style="font-size:16px;">Game 2</div></div>`;
    game2.forEach(m => out += renderHistoricalMatchup(m));
  }
  out += '</div>';
  return out;
}

// Render only the matchups this player was IN that week (their team's G1 + G2)
function renderExpandedWeekForPlayer(season, week, playerName, playerTeam) {
  const matchups = getMatchupsForWeek(season, week);
  if (!matchups.length) return `<div class="empty-state" style="padding:16px;">No matchup data for this week.</div>`;

  // Find matchups where the player's team is involved
  // Player team may have changed week-to-week, so use the team from this week's row
  const myMatchups = matchups.filter(m => {
    if (!m.a) return false;
    if (m.a.team === playerTeam) return true;
    if (m.b && m.b.team === playerTeam) return true;
    return false;
  });

  if (!myMatchups.length) {
    // Fallback: try finding by player presence in roster
    const fallback = matchups.filter(m =>
      (m.a && m.a.players.some(p => p.name === playerName)) ||
      (m.b && m.b.players.some(p => p.name === playerName))
    );
    if (!fallback.length) return `<div class="empty-state" style="padding:16px;">${escapeHtml(playerName)} did not play this week.</div>`;
    myMatchups.push(...fallback);
  }

  const game1 = myMatchups.filter(m => m.gameNum === 1);
  const game2 = myMatchups.filter(m => m.gameNum === 2);
  let out = '<div class="week-expand-inner">';
  if (game1.length) {
    out += `<div class="match-header" style="margin:8px 0 8px;"><div class="match-title" style="font-size:16px;">Game 1</div></div>`;
    game1.forEach(m => out += renderHistoricalMatchup(m));
  }
  if (game2.length) {
    out += `<div class="match-header" style="margin:8px 0 8px;"><div class="match-title" style="font-size:16px;">Game 2</div></div>`;
    game2.forEach(m => out += renderHistoricalMatchup(m));
  }
  out += '</div>';
  return out;
}

// Personal records
function getPersonalRecords(name) {
  const rows = statsRows().filter(r => r[SC.PLAYER] === name && isPresent(r[SC.PRESENT]));
  const recs = { highGame: 0, highSeries: 0, currentStreak: 0, bestStreak: 0, currentStreakType: '', winRate: 0 };

  let scores = [];
  rows.forEach(r => {
    const g1 = parseInt(r[SC.G1]) || 0, g2 = parseInt(r[SC.G2]) || 0;
    if (g1 > 0) scores.push(g1);
    if (g2 > 0) scores.push(g2);
    if (g1 + g2 > recs.highSeries) recs.highSeries = g1 + g2;
  });
  scores.forEach(s => { if (s > recs.highGame) recs.highGame = s; });

  let curStreak = 0, curType = '', best = 0;
  rows.forEach(r => {
    const w = parseInt(r[SC.WINS]) || 0, l = parseInt(r[SC.LOSSES]) || 0;
    if (w > l) {
      if (curType === 'W') curStreak++; else { curStreak = 1; curType = 'W'; }
    } else if (l > w) {
      if (curType === 'L') curStreak++; else { curStreak = 1; curType = 'L'; }
    }
    if (curStreak > best) best = curStreak;
  });
  recs.currentStreak = curStreak;
  recs.bestStreak = best;
  recs.currentStreakType = curType;
  return recs;
}

let _playerChart = null;
function drawPlayerChart(profile) {
  const ctx = $('player-chart'); if (!ctx) return;
  if (_playerChart) _playerChart.destroy();

  // Build labels and split into G1 / G2 series
  const games = profile.games;
  const labels = games.map((g, i) => `S${g.season}W${g.week}.G${g.gameNum}`);
  const data = games.map(g => g.score);
  const avg = profile.avg;

  _playerChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Score',
        data,
        borderColor: '#e8ff47',
        backgroundColor: 'rgba(232,255,71,0.15)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#e8ff47',
        tension: 0.3,
        fill: true
      }, {
        label: 'Avg',
        data: data.map(() => avg),
        borderColor: 'rgba(255,79,109,0.5)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1c1c21', borderColor: '#25252b', borderWidth: 1 } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7a7a85', font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { color: '#7a7a85', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
      }
    }
  });
}

// SEASON HISTORY
function renderSeasonHistoryView() {
  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Past Seasons</div></div></div>`;
  const seasons = getSeasons();
  if (!seasons.length) {
    html += `<div class="empty-state">No completed seasons yet.</div>`;
    $('more-content').innerHTML = html;
    return;
  }

  // Build notes lookup from League History sheet
  const notesMap = {};
  if (state.history && state.history.length > 1) {
    const headers = state.history[0].map(h => String(h).toLowerCase());
    let seasonCol = headers.indexOf('season'); if (seasonCol === -1) seasonCol = 0;
    let notesCol = headers.indexOf('notes');
    if (notesCol !== -1) {
      for (let i = 1; i < state.history.length; i++) {
        const cell = String(state.history[i][seasonCol] || '').trim();
        const key = cell.replace(/season\s*/i, '').trim();
        if (key && state.history[i][notesCol]) notesMap[key] = state.history[i][notesCol];
      }
    }
  }

  // Sort descending so newest first
  seasons.sort((a, b) => parseInt(b) - parseInt(a)).forEach(s => {
    const standings = aggregateStandings(s);
    const champs = championsForSeason(s);
    const top = standings[0];
    const totalPins = standings.reduce((sum, p) => sum + p.pins, 0);
    const totalGames = standings.reduce((sum, p) => sum + p.games, 0);
    const leagueAvg = totalGames ? totalPins / totalGames : 0;
    const totalWeeks = new Set(); statsRows().filter(r => String(r[SC.SEASON]) === String(s)).forEach(r => totalWeeks.add(String(r[SC.WEEK])));
    const notes = notesMap[String(s)] || '';

    html += `<div class="history-season">
      <div class="history-head">
        <div class="history-season-name">Season ${s}</div>
        ${champs.length ? `<div class="history-champion">👑 ${champs.map(escapeHtml).join(', ')}</div>` : ''}
      </div>
      <div class="history-body">
        ${notes ? `<div class="season-blurb">${escapeHtml(notes)}</div>` : ''}
        <div class="history-stat"><span class="history-stat-label">Top Bowler</span><span class="history-stat-val">${top ? escapeHtml(top.name) + ' (' + top.avg.toFixed(1) + ')' : '—'}</span></div>
        <div class="history-stat"><span class="history-stat-label">League Avg</span><span class="history-stat-val">${leagueAvg.toFixed(1)}</span></div>
        <div class="history-stat"><span class="history-stat-label">Bowlers</span><span class="history-stat-val">${standings.length}</span></div>
        <div class="history-stat"><span class="history-stat-label">Weeks</span><span class="history-stat-val">${totalWeeks.size}</span></div>
        <button class="btn sm" style="margin-top:10px;" onclick="openSeasonNotesEdit('${escapeHtml(s)}')">${notes ? 'Edit Notes' : '✏️ Add Notes'}</button>
      </div>
    </div>`;
  });

  $('more-content').innerHTML = html;
}

function openSeasonNotesEdit(season) {
  // Build notes lookup
  let existing = '';
  if (state.history && state.history.length > 1) {
    const headers = state.history[0].map(h => String(h).toLowerCase());
    let seasonCol = headers.indexOf('season'); if (seasonCol === -1) seasonCol = 0;
    let notesCol = headers.indexOf('notes');
    if (notesCol !== -1) {
      for (let i = 1; i < state.history.length; i++) {
        const cell = String(state.history[i][seasonCol] || '').trim();
        const key = cell.replace(/season\s*/i, '').trim();
        if (key === String(season)) existing = state.history[i][notesCol] || '';
      }
    }
  }

  openModal(`<div class="modal-title">Season ${escapeHtml(season)} Notes</div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px;">Tell the story. Memorable moments, drama, who choked in the playoffs.</p>
    <textarea id="season-notes-input" class="modal-input" style="min-height:140px;text-align:left;font-family:'Barlow',sans-serif;line-height:1.5;" placeholder="Season ${escapeHtml(season)} was...">${escapeHtml(existing)}</textarea>
    <div class="btn-row">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveSeasonNotes('${escapeHtml(season)}')">Save</button>
    </div>`);
}

async function saveSeasonNotes(season) {
  const notes = $('season-notes-input').value.trim();
  closeModal();
  toast('Saving...');
  try {
    const r = await apiPost('updateSeasonNotes', { season, notes });
    if (r.error) { toast(r.error, 'error'); return; }
    // Optimistically update local state
    if (state.history && state.history.length > 1) {
      const headers = state.history[0].map(h => String(h).toLowerCase());
      let seasonCol = headers.indexOf('season'); if (seasonCol === -1) seasonCol = 0;
      let notesCol = headers.indexOf('notes');
      if (notesCol === -1) {
        notesCol = state.history[0].length;
        state.history[0].push('Notes');
      }
      let found = false;
      for (let i = 1; i < state.history.length; i++) {
        const cell = String(state.history[i][seasonCol] || '').trim();
        const key = cell.replace(/season\s*/i, '').trim();
        if (key === String(season)) {
          while (state.history[i].length <= notesCol) state.history[i].push('');
          state.history[i][notesCol] = notes;
          found = true; break;
        }
      }
    }
    toast('Saved', 'success');
    renderSeasonHistoryView();
  } catch(e) { toast('Failed', 'error'); }
}

// LEAGUE RECORDS
function renderLeagueRecordsView() {
  const seasons = getSeasons();
  const recs = getLeagueRecords(state.recordsSeason);

  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">League Records</div></div></div>`;
  html += `<div class="filter-bar">
    <select onchange="state.recordsSeason=this.value;renderLeagueRecordsView();">
      <option value="all" ${state.recordsSeason === 'all' ? 'selected' : ''}>All-time</option>
      ${seasons.map(s => `<option value="${s}" ${state.recordsSeason === s ? 'selected' : ''}>Season ${s}</option>`).join('')}
    </select>
  </div>`;

  html += renderRecordCard('🎳', 'High Single Game', recs.highGame.val, recs.highGame.by, recs.highGame.when);
  html += renderRecordCard('📈', 'High Series (G1+G2)', recs.highSeries.val, recs.highSeries.by, recs.highSeries.when);
  html += renderTeamRecordCard('💪', 'High Team Game', recs.highTeamGame.val, recs.highTeamGame.team, recs.highTeamGame.when, recs.highTeamGame.roster);
  html += renderTeamNightCard('🌙', 'High Team Night', recs.highTeamNight);
  html += renderRecordCard('🏆', 'Best Season Avg', recs.bestSeasonAvg.val ? recs.bestSeasonAvg.val.toFixed(1) : 0, recs.bestSeasonAvg.by, recs.bestSeasonAvg.when);

  $('more-content').innerHTML = html;
}

function renderRecordCard(icon, label, val, by, when) {
  if (!val) return `<div class="record-card"><div class="record-card-head"><div class="record-icon">${icon}</div><div class="record-info"><div class="record-label">${label}</div><div class="record-value" style="color:var(--muted);">No record yet</div></div></div></div>`;
  return `<div class="record-card"><div class="record-card-head">
    <div class="record-icon">${icon}</div>
    <div class="record-info">
      <div class="record-label">${label}</div>
      <div class="record-value">${nameWithCrown(by || '')}</div>
      <div class="record-detail">${escapeHtml(when || '')}</div>
    </div>
    <div class="record-num">${val}</div>
  </div></div>`;
}
function renderTeamRecordCard(icon, label, val, team, when, roster) {
  if (!val) return `<div class="record-card"><div class="record-card-head"><div class="record-icon">${icon}</div><div class="record-info"><div class="record-label">${label}</div><div class="record-value" style="color:var(--muted);">No record yet</div></div></div></div>`;
  let rosterHtml = '';
  if (roster && roster.length) {
    rosterHtml = `<div class="record-team-roster">
      ${roster.map(p => `<div class="record-team-row"><span class="name">${nameWithCrown(p.name)}</span><span class="score">${p.score}</span></div>`).join('')}
    </div>`;
  }
  return `<div class="record-card">
    <div class="record-card-head">
      <div class="record-icon">${icon}</div>
      <div class="record-info">
        <div class="record-label">${label}</div>
        <div class="record-value">${escapeHtml(team || '')}</div>
        <div class="record-detail">${escapeHtml(when || '')}</div>
      </div>
      <div class="record-num">${val}</div>
    </div>
    ${rosterHtml}
  </div>`;
}

function renderTeamNightCard(icon, label, rec) {
  if (!rec.val) return `<div class="record-card"><div class="record-card-head"><div class="record-icon">${icon}</div><div class="record-info"><div class="record-label">${label}</div><div class="record-value" style="color:var(--muted);">No record yet</div></div></div></div>`;
  const buildGameSection = (title, total, roster) => {
    if (!roster || !roster.length) return '';
    return `<div class="record-team-game">
      <div class="record-team-game-head">
        <span class="record-team-game-title">${title}</span>
        <span class="record-team-game-total">${total}</span>
      </div>
      ${roster.map(p => `<div class="record-team-row"><span class="name">${nameWithCrown(p.name)}</span><span class="score">${p.score}</span></div>`).join('')}
    </div>`;
  };
  return `<div class="record-card">
    <div class="record-card-head">
      <div class="record-icon">${icon}</div>
      <div class="record-info">
        <div class="record-label">${label}</div>
        <div class="record-value">${escapeHtml(rec.team || '')}</div>
        <div class="record-detail">${escapeHtml(rec.when || '')}</div>
      </div>
      <div class="record-num">${rec.val}</div>
    </div>
    <div class="record-team-roster">
      ${buildGameSection('Game 1', rec.g1Total, rec.g1Roster)}
      ${buildGameSection('Game 2', rec.g2Total, rec.g2Roster)}
    </div>
  </div>`;
}

// HEAD-TO-HEAD
function renderH2HView() {
  const playerNames = Array.from(new Set(statsRows().map(r => r[SC.PLAYER]))).filter(Boolean).sort();

  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Head to Head</div></div></div>`;
  html += `<div class="h2h-controls">
    <select onchange="state.h2hP1=this.value;renderH2HView();">
      <option value="">— Bowler 1 —</option>
      ${playerNames.map(n => `<option value="${escapeHtml(n)}" ${state.h2hP1 === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
    </select>
    <span class="h2h-vs">VS</span>
    <select onchange="state.h2hP2=this.value;renderH2HView();">
      <option value="">— Bowler 2 —</option>
      ${playerNames.map(n => `<option value="${escapeHtml(n)}" ${state.h2hP2 === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
    </select>
  </div>`;

  if (!state.h2hP1 || !state.h2hP2 || state.h2hP1 === state.h2hP2) {
    html += `<div class="empty-state"><div class="empty-state-icon">⚔️</div>Pick two different bowlers to compare.</div>`;
    $('more-content').innerHTML = html;
    return;
  }

  const r = getH2H(state.h2hP1, state.h2hP2);
  if (!r.games.length) {
    html += `<div class="empty-state">These two have never played head-to-head.</div>`;
    $('more-content').innerHTML = html;
    return;
  }

  // Team game record
  const teamLead = r.teamP1Wins > r.teamP2Wins ? 'p1' : (r.teamP2Wins > r.teamP1Wins ? 'p2' : 'tie');
  const pinLead = r.pinP1Wins > r.pinP2Wins ? 'p1' : (r.pinP2Wins > r.pinP1Wins ? 'p2' : 'tie');

  // Single combined header with names, then two stacked compact records
  html += `<div class="h2h-result">
    <div class="h2h-head">
      <div class="h2h-name">${nameWithCrown(state.h2hP1)}</div>
      <div class="h2h-divider">vs</div>
      <div class="h2h-name">${nameWithCrown(state.h2hP2)}</div>
    </div>
    <div class="h2h-stat-row">
      <div class="h2h-stat-label">Team Wins</div>
      <div class="h2h-stat-line">
        <span class="h2h-stat-num ${teamLead === 'p1' ? 'lead' : ''}">${r.teamP1Wins}</span>
        <span class="h2h-stat-dash">—</span>
        <span class="h2h-stat-num ${teamLead === 'p2' ? 'lead' : ''}">${r.teamP2Wins}</span>
      </div>
      ${r.teamTies ? `<div class="h2h-stat-sub">${r.teamTies} tie${r.teamTies>1?'s':''}</div>` : ''}
    </div>
    <div class="h2h-stat-row">
      <div class="h2h-stat-label">Pin Total Wins</div>
      <div class="h2h-stat-line">
        <span class="h2h-stat-num ${pinLead === 'p1' ? 'lead' : ''}">${r.pinP1Wins}</span>
        <span class="h2h-stat-dash">—</span>
        <span class="h2h-stat-num ${pinLead === 'p2' ? 'lead' : ''}">${r.pinP2Wins}</span>
      </div>
      ${r.pinTies ? `<div class="h2h-stat-sub">${r.pinTies} tie${r.pinTies>1?'s':''}</div>` : ''}
    </div>
  </div>`;

  // Meeting log
  html += `<div class="section-header">Every Matchup</div><div class="score-history-table">`;
  html += `<div class="score-history-row head" style="grid-template-columns: 60px 1fr 1fr 50px 50px;"><span>When</span><span>${escapeHtml(state.h2hP1)} pins</span><span>${escapeHtml(state.h2hP2)} pins</span><span>Team Δ</span><span>Win</span></div>`;
  r.games.slice().reverse().forEach(g => {
    const tDiff = g.t1Total - g.t2Total;
    const winner = tDiff > 0 ? state.h2hP1 : (tDiff < 0 ? state.h2hP2 : '—');
    html += `<div class="score-history-row" style="grid-template-columns: 60px 1fr 1fr 50px 50px;">
      <span class="sh-week">S${g.season}W${g.week}.G${g.gameNum}</span>
      <span style="text-align:left;color:${g.p1Score>g.p2Score?'var(--accent)':'var(--text)'};">${g.p1Score}</span>
      <span style="text-align:left;color:${g.p2Score>g.p1Score?'var(--accent)':'var(--text)'};">${g.p2Score}</span>
      <span style="color:${tDiff>=0?'var(--success)':'var(--danger)'};">${tDiff>0?'+':''}${tDiff}</span>
      <span style="font-size:10px;color:var(--muted);">${winner === '—' ? '—' : (winner === state.h2hP1 ? 'P1' : 'P2')}</span>
    </div>`;
  });
  html += `</div>`;

  $('more-content').innerHTML = html;
}

// CHEMISTRY
function renderChemistryView() {
  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Team Chemistry</div></div></div>`;
  html += `<div class="chemistry-tabs">
    <button class="chem-tab ${state.chemMode === 'pairs' ? 'active' : ''}" onclick="state.chemMode='pairs';state.chemExpanded=false;renderChemistryView();">Pairs</button>
    <button class="chem-tab ${state.chemMode === 'trios' ? 'active' : ''}" onclick="state.chemMode='trios';state.chemExpanded=false;renderChemistryView();">Trios</button>
  </div>`;

  const groupSize = state.chemMode === 'pairs' ? 2 : 3;
  const groups = getChemistry(groupSize);

  if (!groups.length) {
    html += `<div class="empty-state">Not enough data yet.</div>`;
    $('more-content').innerHTML = html;
    return;
  }

  const showCount = state.chemExpanded ? groups.length : 10;
  const visible = groups.slice(0, showCount);

  visible.forEach(g => {
    const pct = (g.winRate * 100).toFixed(0);
    html += `<div class="chemistry-card">
      <div class="chem-pair">${g.names.map(n => nameWithCrown(n)).join(' + ')}</div>
      <div class="chem-rate">${pct}%</div>
      <div class="chem-games">${g.wins}—${g.losses} · ${g.weeks}wk</div>
    </div>`;
  });

  if (groups.length > 10 && !state.chemExpanded) {
    html += `<button class="btn" style="margin-top:8px;" onclick="state.chemExpanded=true;renderChemistryView();">Show all ${groups.length}</button>`;
  } else if (state.chemExpanded && groups.length > 10) {
    html += `<button class="btn" style="margin-top:8px;" onclick="state.chemExpanded=false;renderChemistryView();">Show top 10</button>`;
  }

  $('more-content').innerHTML = html;
}

// BOARD
function renderBoard() {
  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Trash Board</div></div></div>`;
  html += `<div class="board-composer">
    <div class="board-author-row">
      <input type="text" class="board-author-input" id="board-author" placeholder="Your name" value="${escapeHtml(state.myName)}">
    </div>
    <textarea id="board-msg" placeholder="Talk shit, hype the boys, whatever..."></textarea>
    <button class="btn primary" style="margin-top:8px;" onclick="postBoard()">Post</button>
  </div>`;

  if (state.board && state.board.length > 1) {
    state.board.slice(1).reverse().forEach(p => {
      if (!p[2]) return;
      html += `<div class="board-post">
        <div class="board-post-head">
          <div class="board-author">${nameWithCrown(p[1] || 'Anon')}</div>
          <div class="board-time">${timeAgo(p[0])}</div>
        </div>
        <div class="board-msg">${escapeHtml(p[2])}</div>
      </div>`;
    });
  } else {
    html += `<div class="empty-state">Be the first to talk some shit.</div>`;
  }
  $('more-content').innerHTML = html;
}

async function postBoard() {
  const author = $('board-author').value.trim();
  const msg = $('board-msg').value.trim();
  if (!author || !msg) { toast('Need name and message', 'error'); return; }
  state.myName = author;
  localStorage.setItem('pb_myname', author);
  try {
    await apiPost('postToBoard', { author, message: msg });
    if (!state.board) state.board = [['Timestamp','Author','Message','ID']];
    state.board.push([new Date().toISOString(), author, msg, 'tmp']);
    renderBoard();
    toast('Posted', 'success');
  } catch(e) { toast('Failed', 'error'); }
}

// ============================================================
// ADD PLAYER
// ============================================================
function openAddPlayer() {
  openModal(`<div class="modal-title">Add Player</div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px;">New bowler will be added to your roster, marked unavailable until they RSVP.</p>
    <input type="text" class="modal-input" id="add-player-name" placeholder="Name" autofocus>
    <div class="btn-row">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="doAddPlayer()">Add</button>
    </div>`);
}
async function doAddPlayer() {
  const name = $('add-player-name').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  closeModal();
  toast('Adding...');
  try {
    const r = await apiPost('addPlayer', { name });
    if (r.error) { toast(r.error, 'error'); return; }
    if (!state.roster) state.roster = [['Name','Status']];
    state.roster.push([name, 'Unavailable']);
    toast(`${name} added`, 'success');
    renderMore();
  } catch(e) { toast('Failed', 'error'); }
}

// ============================================================
// GENERATE TEAMS
// ============================================================
function openGenerate() {
  state.moreView = 'generate';
  state.genTeams = null;
  state.genSwapTarget = null;
  renderGenerate();
}
function renderGenerate() {
  let html = `<div class="player-detail-header"><button class="back-btn" onclick="backToMore()">←</button><div><div class="player-detail-name">Generate Teams</div></div></div>`;

  // Count available players for hints
  const availCount = state.roster ? state.roster.slice(1).filter(r => r[0] && r[1] === 'Available').length : 0;
  const requiredCount = state.genNumTeams * state.genTeamSize;

  html += `<div class="gen-controls">
    <div class="gen-row">
      <div class="gen-label">Number of Teams</div>
      <div class="toggle-group">
        ${[2,3,4,5,6].map(n => `<button class="toggle-btn ${state.genNumTeams===n?'active':''}" onclick="state.genNumTeams=${n};state.genTeams=null;renderGenerate();">${n}</button>`).join('')}
      </div>
    </div>
    <div class="gen-row">
      <div class="gen-label">Players per Team</div>
      <div class="toggle-group">
        ${[2,3,4,5].map(n => `<button class="toggle-btn ${state.genTeamSize===n?'active':''}" onclick="state.genTeamSize=${n};state.genTeams=null;renderGenerate();">${n}</button>`).join('')}
      </div>
    </div>
    <div class="gen-row">
      <div class="gen-label">Avg Source</div>
      <div class="toggle-group">
        <button class="toggle-btn ${state.genAvgSource==='last-season'?'active':''}" onclick="state.genAvgSource='last-season';renderGenerate();">Last Season</button>
        <button class="toggle-btn ${state.genAvgSource==='current-season'?'active':''}" onclick="state.genAvgSource='current-season';renderGenerate();">Current</button>
        <button class="toggle-btn ${state.genAvgSource==='all-time'?'active':''}" onclick="state.genAvgSource='all-time';renderGenerate();">All-time</button>
      </div>
    </div>
    <div class="gen-row">
      <div class="gen-label">Fill MIA Players With</div>
      <div class="toggle-group">
        <button class="toggle-btn ${state.genFillMode==='League Avg'?'active':''}" onclick="state.genFillMode='League Avg';renderGenerate();">League Avg</button>
        <button class="toggle-btn ${state.genFillMode==='Their Avg'?'active':''}" onclick="state.genFillMode='Their Avg';renderGenerate();">Their Avg</button>
      </div>
    </div>
    <div class="gen-row">
      <label style="display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer;background:var(--surface2);border-radius:10px;">
        <input type="checkbox" id="gen-fill-to-size" ${state.genFillToSize?'checked':''} onchange="state.genFillToSize=this.checked;renderGenerate();" style="width:18px;height:18px;accent-color:var(--accent);">
        <span style="font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:13px;">Pad short teams with league avg placeholders</span>
      </label>
    </div>
    <div style="font-size:12px;color:var(--muted);padding:6px 0;line-height:1.5;">
      Need <strong style="color:var(--accent);">${requiredCount}</strong> players · <strong style="color:${availCount>=requiredCount?'var(--success)':'var(--danger)'};">${availCount} available</strong>
      ${availCount < requiredCount && !state.genFillToSize ? ` · <span style="color:var(--danger);">Short ${requiredCount - availCount}</span>` : ''}
    </div>
    <button class="btn primary" onclick="doGenerate()">Generate</button>
  </div>`;

  if (state.genTeams) {
    html += `<div class="section-header">Generated Teams<div class="actions"><span class="right-text">${state.genSwapTarget ? 'Tap a player to swap' : 'Tap "Swap" to start'}</span></div></div>`;
    state.genTeams.forEach((t, i) => {
      const total = t.players.reduce((s, p) => s + p.avg, 0);
      html += `<div class="team-preview-card">
        <div class="tp-head"><div class="tp-name">Team ${i + 1}</div><div class="tp-total">${Math.round(total)}</div></div>
        <div class="tp-list">`;
      t.players.forEach((p, pIdx) => {
        const isSwapTarget = state.genSwapTarget && state.genSwapTarget.team === i && state.genSwapTarget.idx === pIdx;
        const isFill = p.isFill || p.status === 'Fill';
        html += `<div class="tp-row">
          <div class="tp-player ${p.status === 'Unavailable' ? 'unavail' : ''} ${isFill ? 'fill' : ''}">
            ${isFill ? `<span style="color:var(--muted);font-style:italic;">League Avg Fill</span>` : nameWithCrown(p.name)}
            ${p.status === 'Unavailable' ? '<span class="absent-tag">OUT</span>' : ''}
            ${isFill ? '<span class="fill-tag">FILL</span>' : ''}
          </div>
          <div class="tp-avg">${p.avg.toFixed(1)}</div>
          ${isFill ? '' : `<button class="swap-btn ${isSwapTarget ? 'selected' : ''}" onclick="handleSwap(${i}, ${pIdx})">${isSwapTarget ? 'Pick swap' : 'Swap'}</button>`}
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `<button class="btn primary" style="margin-top:12px;" onclick="confirmGenerate()">Use These Teams</button>`;
  }

  $('more-content').innerHTML = html;
}

async function doGenerate() {
  // Refresh roster from server first so latest RSVPs are reflected
  toast('Loading roster...');
  try {
    const fresh = await apiGet('getRoster');
    if (Array.isArray(fresh)) state.roster = fresh;
  } catch(e) { /* non-fatal, fall through */ }

  toast('Generating...');
  let r;
  try {
    r = await apiPost('generateTeams', {
      fillMode: state.genFillMode,
      avgSource: state.genAvgSource,
      numTeams: state.genNumTeams,
      teamSize: state.genTeamSize,
      fillToSize: state.genFillToSize
    });
  } catch(e) {
    const msg = (e && (e.message || e.toString())) || 'unknown';
    toast('Network error: ' + String(msg).slice(0, 100), 'error');
    console.error('generateTeams network error:', e);
    return;
  }
  if (!r) {
    toast('No response from server', 'error');
    return;
  }
  if (r.error) {
    toast('Server: ' + String(r.error).slice(0, 80), 'error');
    console.error('generateTeams error:', r);
    return;
  }
  if (!r.teams || !Array.isArray(r.teams)) {
    toast('Invalid response shape', 'error');
    console.error('Bad shape:', r);
    return;
  }
  state.genTeams = r.teams;
  state.genSwapTarget = null;
  renderGenerate();
}

function handleSwap(team, idx) {
  if (!state.genSwapTarget) {
    state.genSwapTarget = { team, idx };
  } else if (state.genSwapTarget.team === team && state.genSwapTarget.idx === idx) {
    state.genSwapTarget = null;
  } else {
    // Perform swap
    const a = state.genTeams[state.genSwapTarget.team].players[state.genSwapTarget.idx];
    const b = state.genTeams[team].players[idx];
    state.genTeams[state.genSwapTarget.team].players[state.genSwapTarget.idx] = b;
    state.genTeams[team].players[idx] = a;
    state.genSwapTarget = null;
  }
  renderGenerate();
}

async function confirmGenerate() {
  if (!state.genTeams) return;
  toast('Confirming...');
  try {
    await apiPost('confirmMatchups', {
      teams: state.genTeams.map(t => t.players),
      avgSource: state.genAvgSource
    });
    toast('Teams set!', 'success');
    await loadAll();
    state.moreView = 'home'; renderMore();
    switchTab('matchups');
  } catch(e) { toast('Failed', 'error'); }
}

// ============================================================
// ARCHIVE & END SEASON
// ============================================================
function confirmArchive() {
  openModal(`<div class="modal-title">Archive & Advance Week?</div>
    <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:16px;">
      Saves this week's scores to your archive, increments the week, and clears the scoreboard.
    </p>
    <div class="btn-row">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="doArchive()">Archive & Advance</button>
    </div>`);
}
async function doArchive() {
  closeModal(); toast('Archiving...');
  try {
    const r = await apiPost('archiveAndAdvance');
    if (r.error) { toast(r.error, 'error'); return; }
    toast(`Saved ${r.rowsAdded} rows`, 'success');
    await loadAll(); renderMatchups(); renderMore();
  } catch(e) { toast('Failed', 'error'); }
}

function openEndSeason() {
  // Get current season's available bowlers for champion picker
  const seasonNum = parseInt(getCurrentSeason()) || 1;
  const players = aggregateStandings(String(seasonNum)).map(p => p.name);
  const rosterPlayers = state.roster ? state.roster.slice(1).filter(r => r[0]).map(r => r[0]) : [];
  const all = Array.from(new Set([...players, ...rosterPlayers])).sort();

  openModal(`<div class="modal-title">End Season ${seasonNum}</div>
    <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:16px;">
      Choose champion(s). For team championships, select all members.
      Season will roll over to ${seasonNum + 1} and current week resets to 1.
    </p>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:8px;margin-bottom:12px;">
      ${all.map(n => `<label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;">
        <input type="checkbox" class="end-season-champ" value="${escapeHtml(n)}" style="accent-color:var(--gold);width:18px;height:18px;">
        <span style="font-family:'Barlow Condensed',sans-serif;font-weight:600;">${escapeHtml(n)}</span>
      </label>`).join('')}
    </div>
    <textarea class="modal-input" id="end-season-notes" placeholder="Notes (optional)" style="text-align:left;min-height:60px;"></textarea>
    <div class="btn-row">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="doEndSeason()">End Season</button>
    </div>`);
}
async function doEndSeason() {
  const champions = Array.from(document.querySelectorAll('.end-season-champ:checked')).map(c => c.value);
  const notes = $('end-season-notes').value.trim();
  closeModal(); toast('Ending season...');
  try {
    const r = await apiPost('endSeason', { champions, notes });
    if (r.error) { toast(r.error, 'error'); return; }
    toast(`Season ${r.season} closed`, 'success');
    await loadAll(); renderMatchups(); renderMore();
  } catch(e) { toast('Failed', 'error'); }
}

// ============================================================
// LOAD
// ============================================================
async function loadAll() {
  try {
    const all = await apiGet('getAll');
    state.current = all.currentWeek;
    state.active = all.activeWeek;
    state.roster = all.roster;
    state.rsvp = all.rsvp;
    state.stats = all.stats;
    state.board = all.board;
    state.history = all.history;
    state.champions = all.champions;
    state.generated = all.generated;
    state.settings = all.settings;
    renderMatchups();
  } catch(e) {
    $('matchups-content').innerHTML = `<div class="error-banner">Could not load data. Check your connection or the API URL.</div>`;
  }
}

loadAll();

