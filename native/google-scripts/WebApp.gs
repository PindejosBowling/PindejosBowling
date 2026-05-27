/**
 * PINDEJOS BOWLING — UNIFIED APPS SCRIPT (v4)
 *
 * SETUP:
 *   1. Replace WebApp.gs with this file
 *   2. Save → run setupAllSheets() once
 *   3. Manually populate Season Champions for past seasons
 *      (Season=1, Player=CJ ; Season=1, Player=Troy ; Season=1, Player=Nick)
 *   4. Deploy → New Version
 */

const SHEETS = {
  ROSTER: "Roster Avgs",
  RSVP: "Weekly RSVP",
  GENERATED: "Generated Teams",
  CURRENT: "Current Week",
  ACTIVE: "Active Week",
  STATS: "Weekly Scores",
  HISTORY: "League History",
  CHAMPIONS: "Season Champions",
  BOARD: "Trash Board",
  SETTINGS: "Settings"
};

const ACTIVE_HEADERS = ['Season', 'Week', 'Team', 'Slot', 'Name', 'G1 Score', 'G2 Score', 'G3 Score', 'G1 Opp', 'G2 Opp', 'G3 Opp', 'Is Fill'];
const AW = { SEASON: 0, WEEK: 1, TEAM: 2, SLOT: 3, NAME: 4, G1: 5, G2: 6, G3: 7, G1_OPP: 8, G2_OPP: 9, G3_OPP: 10, IS_FILL: 11 };

const SC = {
  SEASON: 0, WEEK: 1, PLAYER: 2, TEAM: 3,
  G1: 4, G1_OPP: 5, G2: 6, G2_OPP: 7,
  PINS: 8, WINS: 9, LOSSES: 10, GAMES: 11, PRESENT: 12
};

const STATS_HEADERS = [
  'Season', 'Week', 'Player', 'Team',
  'Game 1', 'Game 1 Opp', 'Game 2', 'Game 2 Opp',
  'Total Pins', 'Total Wins', 'Total Losses', 'Total Games', 'Present'
];

function doGet(e) {
  try {
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (action) {
      case 'getCurrentWeek': return sendJSON(getSheetData(ss, SHEETS.CURRENT));
      case 'getActiveWeek':  return sendJSON(getSheetData(ss, SHEETS.ACTIVE));
      case 'getRoster':      return sendJSON(getSheetData(ss, SHEETS.ROSTER));
      case 'getStandings':   return sendJSON(getSheetData(ss, SHEETS.ROSTER));
      case 'getRSVP':        return sendJSON(getSheetData(ss, SHEETS.RSVP));
      case 'getGenerated':   return sendJSON(getSheetData(ss, SHEETS.GENERATED));
      case 'getStats':       return sendJSON(getSheetData(ss, SHEETS.STATS));
      case 'getHistory':     return sendJSON(getSheetData(ss, SHEETS.HISTORY));
      case 'getChampions':   return sendJSON(getSheetData(ss, SHEETS.CHAMPIONS));
      case 'getBoard':       return sendJSON(getSheetData(ss, SHEETS.BOARD));
      case 'getSettings':    return sendJSON(getSheetData(ss, SHEETS.SETTINGS));
      case 'getAll':         return sendJSON(getAllPayload(ss));
      default:               return sendJSON({ error: 'Unknown action: ' + action });
    }
  } catch (err) { return sendJSON({ error: err.toString() }); }
}

function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (params.action) {
      case 'updateScore':       return updateScore(ss, params);
      case 'updateActiveScore': return updateActiveScore(ss, params);
      case 'batchUpdateScores': return batchUpdateScores(ss, params);
      case 'updateRSVP':        return updateRSVP(ss, params);
      case 'batchUpdateRSVP':   return batchUpdateRSVP(ss, params);
      case 'resetRSVP':         return resetRSVP(ss);
      case 'addPlayer':         return addPlayerAction(ss, params);
      case 'generateTeams':     return generateTeamsAction(ss, params);
      case 'confirmMatchups':   return confirmMatchups(ss, params);
      case 'archiveAndAdvance': return archiveAndAdvance(ss, params);
      case 'endSeason':         return endSeason(ss, params);
      case 'updateSeasonNotes': return updateSeasonNotes(ss, params);
      case 'postToBoard':       return postToBoard(ss, params);
      case 'deleteBoardPost':   return deleteBoardPost(ss, params);
      case 'updateSetting':     return updateSetting(ss, params);
      default:                  return sendJSON({ error: 'Unknown action: ' + params.action });
    }
  } catch (err) { return sendJSON({ error: err.toString(), stack: err.stack }); }
}

function sendJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function getSheetData(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  return sheet.getDataRange().getValues();
}
function getAllPayload(ss) {
  return {
    currentWeek: getSheetData(ss, SHEETS.CURRENT),
    activeWeek:  getSheetData(ss, SHEETS.ACTIVE),
    roster:      getSheetData(ss, SHEETS.ROSTER),
    rsvp:        getSheetData(ss, SHEETS.RSVP),
    stats:       getSheetData(ss, SHEETS.STATS),
    board:       getSheetData(ss, SHEETS.BOARD),
    settings:    getSheetData(ss, SHEETS.SETTINGS),
    history:     getSheetData(ss, SHEETS.HISTORY),
    champions:   getSheetData(ss, SHEETS.CHAMPIONS),
    generated:   getSheetData(ss, SHEETS.GENERATED)
  };
}
function getSetting(ss, key, fallback) {
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet) return fallback;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) if (data[i][0] === key) return data[i][1];
  return fallback;
}
function setSetting(ss, key, value) {
  const sheet = ensureSheet(ss, SHEETS.SETTINGS, ['Key', 'Value']);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

function updateScore(ss, params) {
  ss.getSheetByName(SHEETS.CURRENT).getRange(params.cell).setValue(params.score);
  return sendJSON({ status: 'success', cell: params.cell, score: params.score });
}

// Update a score in Active Week by (team, slot, game)
// params: { team: 'Team 1', slot: 0, gameNum: 1, score: '120' }
function updateActiveScore(ss, params) {
  const sheet = ensureSheet(ss, SHEETS.ACTIVE, ACTIVE_HEADERS);
  const data = sheet.getDataRange().getValues();
  const team = String(params.team);
  const slot = parseInt(params.slot);
  const gameNum = parseInt(params.gameNum);
  const scoreCol = gameNum === 1 ? AW.G1 : (gameNum === 2 ? AW.G2 : AW.G3);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][AW.TEAM]) === team && parseInt(data[i][AW.SLOT]) === slot) {
      sheet.getRange(i + 1, scoreCol + 1).setValue(params.score === '' ? '' : parseInt(params.score));
      return sendJSON({ status: 'success', team, slot, gameNum, score: params.score });
    }
  }
  return sendJSON({ error: `Slot not found: ${team} slot ${slot}` });
}

// Batch update: takes { scores: [{team, slot, gameNum, score}|{cell, score, legacy}, ...] }
// Reads each sheet once, writes all changes.
function batchUpdateScores(ss, params) {
  const scores = params.scores || [];
  if (!scores.length) return sendJSON({ status: 'success', updated: 0 });

  const activeScores = scores.filter(s => !s.legacy);
  const legacyScores = scores.filter(s => s.legacy);

  let updated = 0;
  const errors = [];

  // Active Week batch
  if (activeScores.length) {
    const sheet = ensureSheet(ss, SHEETS.ACTIVE, ACTIVE_HEADERS);
    const data = sheet.getDataRange().getValues();
    // Build (team|slot) -> row index lookup once
    const rowMap = {};
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][AW.TEAM]) + '|' + parseInt(data[i][AW.SLOT]);
      rowMap[key] = i + 1;
    }
    activeScores.forEach(s => {
      const key = String(s.team) + '|' + parseInt(s.slot);
      const row = rowMap[key];
      if (!row) { errors.push(`No slot: ${key}`); return; }
      const gn = parseInt(s.gameNum);
      const col = gn === 1 ? AW.G1 + 1 : (gn === 2 ? AW.G2 + 1 : AW.G3 + 1);
      sheet.getRange(row, col).setValue(s.score === '' ? '' : parseInt(s.score));
      updated++;
    });
  }

  // Legacy Current Week cell-based writes (fallback)
  if (legacyScores.length) {
    const sheet = ss.getSheetByName(SHEETS.CURRENT);
    if (!sheet) {
      errors.push('Current Week sheet not found');
    } else {
      legacyScores.forEach(s => {
        try {
          sheet.getRange(s.cell).setValue(s.score === '' ? '' : parseInt(s.score));
          updated++;
        } catch(e) { errors.push('Failed: ' + s.cell); }
      });
    }
  }

  return sendJSON({ status: 'success', updated, errors });
}


function updateRSVP(ss, params) {
  const sheet = ensureSheet(ss, SHEETS.RSVP, ['Player', 'Status', 'Note', 'Updated']);
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) if (data[i][0] === params.name) { rowIdx = i + 1; break; }
  if (rowIdx === -1) sheet.appendRow([params.name, params.status, params.note || '', now]);
  else sheet.getRange(rowIdx, 1, 1, 4).setValues([[params.name, params.status, params.note || '', now]]);
  syncRosterStatus(ss, params.name, params.status);
  return sendJSON({ status: 'success' });
}

// Batch update: takes { changes: [{name, status, note}, ...] }
// Single sheet read + single batched range write for both RSVP and Roster.
function batchUpdateRSVP(ss, params) {
  const changes = params.changes || [];
  if (!changes.length) return sendJSON({ status: 'success', updated: 0 });

  const rsvpSheet = ensureSheet(ss, SHEETS.RSVP, ['Player', 'Status', 'Note', 'Updated']);
  const rsvpData = rsvpSheet.getDataRange().getValues();
  const now = new Date();

  // Build name -> existing row index
  const rsvpRowMap = {};
  for (let i = 1; i < rsvpData.length; i++) {
    if (rsvpData[i][0]) rsvpRowMap[rsvpData[i][0]] = i + 1;
  }

  // Updates to existing rows: collect by row index for a single setValues call (sparse)
  const updates = [];   // {row, vals}
  const appends = [];   // new rows to append at end
  changes.forEach(c => {
    const name = c.name;
    if (!name) return;
    const row = [name, c.status || '', c.note || '', now];
    if (rsvpRowMap[name]) {
      updates.push({ row: rsvpRowMap[name], vals: row });
    } else {
      appends.push(row);
    }
  });

  // Apply updates - one setValues per row is unavoidable for sparse rows, but limit to changed cells only
  updates.forEach(u => rsvpSheet.getRange(u.row, 1, 1, 4).setValues([u.vals]));
  if (appends.length) {
    rsvpSheet.getRange(rsvpSheet.getLastRow() + 1, 1, appends.length, 4).setValues(appends);
  }

  // Sync Roster status in batch
  const rosterSheet = ss.getSheetByName(SHEETS.ROSTER);
  if (rosterSheet) {
    const rosterData = rosterSheet.getDataRange().getValues();
    const statusByName = {};
    changes.forEach(c => { statusByName[c.name] = (c.status === 'In') ? 'Available' : 'Unavailable'; });
    const rosterUpdates = [];
    for (let i = 1; i < rosterData.length; i++) {
      if (rosterData[i][0] && statusByName[rosterData[i][0]] !== undefined) {
        rosterUpdates.push({ row: i + 1, val: statusByName[rosterData[i][0]] });
      }
    }
    rosterUpdates.forEach(u => rosterSheet.getRange(u.row, 2).setValue(u.val));
  }

  return sendJSON({ status: 'success', updated: changes.length });
}

function syncRosterStatus(ss, name, rsvpStatus) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sheet.getRange(i + 1, 2).setValue((rsvpStatus === 'In') ? 'Available' : 'Unavailable');
      return;
    }
  }
}
function resetRSVP(ss) {
  const sheet = ss.getSheetByName(SHEETS.RSVP);
  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  const roster = ss.getSheetByName(SHEETS.ROSTER);
  if (roster) {
    const data = roster.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) if (data[i][0]) roster.getRange(i + 1, 2).setValue('Unavailable');
  }
  return sendJSON({ status: 'success' });
}

function addPlayerAction(ss, params) {
  const name = (params.name || '').trim();
  if (!name) return sendJSON({ error: 'Name required' });
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  if (!sheet) return sendJSON({ error: 'Roster Avgs sheet not found' });
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).toLowerCase() === name.toLowerCase()) {
      return sendJSON({ error: 'Player already exists: ' + data[i][0] });
    }
  }
  const lastCol = Math.max(sheet.getLastColumn(), 2);
  const newRow = new Array(lastCol).fill('');
  newRow[0] = name;
  newRow[1] = 'Unavailable';
  sheet.appendRow(newRow);
  return sendJSON({ status: 'success', name });
}

function generateTeamsAction(ss, params) {
  // Debug-friendly: wrap everything so we always return JSON instead of throwing a 500.
  // Pass skipSheetWrite=true from the client if you want to test without the audit-log write.
  try {
    const fillMode = params.fillMode || 'League Avg';
    const avgSource = params.avgSource || 'last-season';
    const numTeams = Math.max(2, Math.min(6, parseInt(params.numTeams) || 4));
    const teamSize = Math.max(2, Math.min(5, parseInt(params.teamSize) || 3));
    const fillToSize = !!params.fillToSize;
    const skipSheetWrite = !!params.skipSheetWrite;

    const avgMap = computeAverages(ss, avgSource);
    const leagueAvg = computeLeagueAverage(avgMap);
    const rosterSheet = ss.getSheetByName(SHEETS.ROSTER);
    if (!rosterSheet) return sendJSON({ error: 'Roster Avgs sheet not found' });
    const rosterData = rosterSheet.getDataRange().getValues();

  const realPlayers = [], miaPlayers = [];
  for (let i = 1; i < rosterData.length; i++) {
    const name = rosterData[i][0];
    if (!name) continue;
    const status = rosterData[i][1] || 'Unavailable';
    const playerAvg = avgMap[name];
    let avg;
    if (status === 'Available') {
      avg = playerAvg !== undefined ? playerAvg : leagueAvg;
    } else {
      avg = (fillMode === 'League Avg') ? leagueAvg : (playerAvg !== undefined ? playerAvg : leagueAvg);
    }
    const player = { name, status, avg, sourceAvg: playerAvg };
    if (status === 'Available') realPlayers.push(player); else miaPlayers.push(player);
  }
  realPlayers.sort((a, b) => b.avg - a.avg);
  miaPlayers.sort((a, b) => b.avg - a.avg);

  const teams = Array.from({ length: numTeams }, () => []);
  let forward = true, teamIdx = 0;
  const totalSlots = numTeams * teamSize;
  function distribute(p) {
    teams[teamIdx].push(p);
    if (forward) { teamIdx++; if (teamIdx === numTeams) { teamIdx = numTeams - 1; forward = false; } }
    else { teamIdx--; if (teamIdx < 0) { teamIdx = 0; forward = true; } }
  }
  // Distribute available (Real/RSVPed In) players first, up to total slots
  const useReal = realPlayers.slice(0, totalSlots);
  useReal.forEach(distribute);
  // If still slots remaining AND we're NOT padding with fills, pull from MIA pool (absent real bodies)
  if (useReal.length < totalSlots && !fillToSize) {
    const needed = totalSlots - useReal.length;
    const miaToUse = miaPlayers.slice(0, needed);
    miaToUse.forEach(distribute);
  }
  // If user opted in to fillToSize, pad remaining slots with League Avg Fill placeholders
  if (fillToSize) {
    teams.forEach(t => {
      while (t.length < teamSize) {
        t.push({ name: 'League Avg Fill', status: 'Fill', avg: leagueAvg, sourceAvg: null, isFill: true });
      }
    });
  }

    // Write to Generated Teams sheet (non-fatal: if this fails, we still return team data to client)
    if (!skipSheetWrite) {
      try {
        writeGeneratedTeamsSheet(ss, teams, fillMode, avgSource);
      } catch(e) {
        // Log but don't fail the request
        Logger.log('writeGeneratedTeamsSheet failed: ' + e.toString());
      }
    }

    return sendJSON({
      status: 'success',
      teams: teams.map(t => ({ total: t.reduce((s, p) => s + p.avg, 0), players: t })),
      leagueAvg, fillMode, avgSource, numTeams, teamSize,
      totalPlayers: realPlayers.length + miaPlayers.length
    });
  } catch(err) {
    return sendJSON({ error: 'generateTeams failed: ' + err.toString(), stack: err.stack ? String(err.stack).slice(0, 500) : '' });
  }
}

function computeAverages(ss, source) {
  const stats = ss.getSheetByName(SHEETS.STATS);
  if (!stats) return {};
  const data = stats.getDataRange().getValues();
  if (data.length < 2) return {};
  const seasons = new Set();
  for (let i = 1; i < data.length; i++) if (data[i][SC.PLAYER]) seasons.add(String(data[i][SC.SEASON]));
  const seasonList = Array.from(seasons).sort();
  const currentSeason = seasonList.length ? seasonList[seasonList.length - 1] : null;
  const lastSeason = seasonList.length > 1 ? seasonList[seasonList.length - 2] : currentSeason;

  let filterSeason = null;
  if (source === 'current-season') filterSeason = currentSeason;
  else if (source === 'last-season') filterSeason = lastSeason;

  const agg = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[SC.PLAYER]) continue;
    if (r[SC.PRESENT] !== true && r[SC.PRESENT] !== 'TRUE' && r[SC.PRESENT] !== 1) continue;
    if (filterSeason !== null && String(r[SC.SEASON]) !== String(filterSeason)) continue;
    const name = r[SC.PLAYER];
    if (!agg[name]) agg[name] = { pins: 0, games: 0 };
    agg[name].pins += parseInt(r[SC.PINS]) || 0;
    agg[name].games += parseInt(r[SC.GAMES]) || 0;
  }
  const out = {};
  Object.keys(agg).forEach(n => { if (agg[n].games > 0) out[n] = agg[n].pins / agg[n].games; });
  return out;
}

function computeLeagueAverage(avgMap) {
  const vals = Object.values(avgMap);
  if (!vals.length) return 130;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function writeGeneratedTeamsSheet(ss, teams, fillMode, avgSource) {
  const sheet = ensureSheet(ss, SHEETS.GENERATED, ['Team', 'Player', 'Avg', 'Status']);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 4);
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();

  // CRITICAL: clear any data validation rules on the sheet's data range.
  // Otherwise, a "League Avg Fill" placeholder will violate a Player-name dropdown rule
  // and the whole response will fail. We rewrite all rows from scratch so validation isn't needed.
  try {
    sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), Math.max(4, sheet.getMaxColumns())).clearDataValidations();
  } catch(e) { /* non-fatal */ }

  // Build all the data into a single 2D array, then write in ONE setValues call.
  const allRows = [];
  const teamHeaderRowIndices = [];
  const unavailRowIndices = [];

  teams.forEach((t, i) => {
    const total = t.reduce((s, p) => s + (Number(p.avg) || 0), 0);
    teamHeaderRowIndices.push(allRows.length);
    allRows.push(['Team ' + (i + 1), '', Math.round(total), '']);
    t.forEach(p => {
      const avgNum = Number(p.avg) || 0;
      const rowData = ['', p.name || '', avgNum.toFixed(1), p.status || ''];
      if (p.status === 'Unavailable') unavailRowIndices.push(allRows.length);
      allRows.push(rowData);
    });
    allRows.push(['', '', '', '']);  // spacer row
  });

  if (allRows.length) {
    sheet.getRange(2, 1, allRows.length, 4).setValues(allRows);
    teamHeaderRowIndices.forEach(idx => {
      sheet.getRange(idx + 2, 1, 1, 4).setFontWeight('bold').setBackground('#1c1c21').setFontColor('#e8ff47');
    });
    unavailRowIndices.forEach(idx => {
      sheet.getRange(idx + 2, 1, 1, 4).setBackground('#3a1f24');
    });
  }

  try {
    sheet.getRange(1, 6).setValue(`Generated ${new Date().toLocaleString()} · Fill: ${fillMode} · Source: ${avgSource}`);
  } catch(e) { /* non-critical */ }
}

// Build a schedule for N teams (2-6) such that every team plays AT LEAST 2 games per night.
// Strategy:
//   2 teams: 2 games (rematch)
//   3 teams: 3 games (round robin — each pair plays once)
//   4 teams: 2 games (standard pair rotation)
//   5 teams: 3 games (different team sits each game, so 4 teams play 3 games and 1 plays 2)
//            Actually with 5 teams and 1-bye-per-game, after 3 games: 3 teams have played 3, 2 teams have played 2.
//            Distribute byes so the smallest count is 2.
//   6 teams: 2 games (standard pair rotation, 3 pairs per game)
function buildSchedule(numTeams) {
  const teamNames = [];
  for (let i = 1; i <= numTeams; i++) teamNames.push('Team ' + i);

  // For 2 teams, rematch
  if (numTeams === 2) {
    return [
      { game: 1, a: 'Team 1', b: 'Team 2' },
      { game: 2, a: 'Team 1', b: 'Team 2' }
    ];
  }

  // For 3 teams, full round robin = 3 games
  if (numTeams === 3) {
    return [
      { game: 1, a: 'Team 1', b: 'Team 2' },
      { game: 2, a: 'Team 1', b: 'Team 3' },
      { game: 3, a: 'Team 2', b: 'Team 3' }
    ];
  }

  // For 4 teams, 2 games with rotated pairings (existing behavior, every team plays both games)
  if (numTeams === 4) {
    return [
      { game: 1, a: 'Team 1', b: 'Team 3' },
      { game: 1, a: 'Team 2', b: 'Team 4' },
      { game: 2, a: 'Team 4', b: 'Team 1' },
      { game: 2, a: 'Team 3', b: 'Team 2' }
    ];
  }

  // For 5 teams, 3 games with rotating bye
  // Game 1: T5 sits, pairs (T1vT2, T3vT4)
  // Game 2: T3 sits, pairs (T1vT5, T2vT4)
  // Game 3: T1 sits, pairs (T2vT5, T3vT4) — wait, T3vT4 would repeat. Let's adjust:
  // Game 3: T1 sits, pairs (T2vT3, T4vT5)
  if (numTeams === 5) {
    return [
      { game: 1, a: 'Team 1', b: 'Team 2' },
      { game: 1, a: 'Team 3', b: 'Team 4' },
      { game: 2, a: 'Team 1', b: 'Team 5' },
      { game: 2, a: 'Team 2', b: 'Team 4' },
      { game: 3, a: 'Team 2', b: 'Team 3' },
      { game: 3, a: 'Team 4', b: 'Team 5' }
    ];
  }

  // For 6 teams, 2 games with rotated pairings (every team plays both games, no byes)
  // Game 1: (T1vT2, T3vT4, T5vT6)
  // Game 2: rotate so pairs differ: (T2vT3, T4vT5, T6vT1)
  if (numTeams === 6) {
    return [
      { game: 1, a: 'Team 1', b: 'Team 2' },
      { game: 1, a: 'Team 3', b: 'Team 4' },
      { game: 1, a: 'Team 5', b: 'Team 6' },
      { game: 2, a: 'Team 2', b: 'Team 3' },
      { game: 2, a: 'Team 4', b: 'Team 5' },
      { game: 2, a: 'Team 6', b: 'Team 1' }
    ];
  }

  // Fallback (shouldn't reach here given the 2-6 clamp)
  return [];
}

function confirmMatchups(ss, params) {
  if (!params.teams || !params.teams.length) return sendJSON({ error: 'No teams provided' });
  const numTeams = params.teams.length;
  if (numTeams < 2 || numTeams > 6) return sendJSON({ error: 'Need 2-6 teams' });

  // Compute league avg up-front so we can pre-write scores for absent players + fills
  const avgSource = params.avgSource || 'last-season';
  const avgMap = computeAverages(ss, avgSource);
  const leagueAvg = Math.round(computeLeagueAverage(avgMap));

  // Build RSVP map so we can detect absent (Out) players
  const rsvpSheet = ss.getSheetByName(SHEETS.RSVP);
  const rsvpMap = {};
  if (rsvpSheet) {
    const r = rsvpSheet.getDataRange().getValues();
    for (let i = 1; i < r.length; i++) if (r[i][0]) rsvpMap[r[i][0]] = r[i][1];
  }

  // Build team -> player list mapping
  const teamPlayers = {};
  params.teams.forEach((teamArr, i) => {
    const teamName = 'Team ' + (i + 1);
    teamPlayers[teamName] = teamArr.map(p => ({
      name: p.name || p,
      isFill: !!p.isFill,
      avg: p.avg || 0
    }));
  });

  const schedule = buildSchedule(numTeams);
  // Compute each team's opponent per game round (1-3)
  const oppMap = { 1: {}, 2: {}, 3: {} };
  schedule.forEach(s => {
    if (s.b) {
      oppMap[s.game][s.a] = s.b;
      oppMap[s.game][s.b] = s.a;
    } else {
      oppMap[s.game][s.a] = '';
    }
  });

  // Find the max game number actually scheduled (2 for most configs, 3 for 3-team/5-team)
  const maxGame = schedule.reduce((m, s) => Math.max(m, s.game), 1);

  // Write Active Week sheet
  const active = ensureSheet(ss, SHEETS.ACTIVE, ACTIVE_HEADERS);
  // Clear all existing rows
  const lastRow = active.getLastRow();
  if (lastRow > 1) active.getRange(2, 1, lastRow - 1, ACTIVE_HEADERS.length).clearContent();

  const season = parseInt(getSetting(ss, 'CurrentSeason', 1)) || 1;
  // Read current week number from Current Week sheet A1 (or default 1)
  const cw = ss.getSheetByName(SHEETS.CURRENT);
  let week = 1;
  if (cw) {
    const v = cw.getRange('A1').getValue();
    if (typeof v === 'string') { const m = v.match(/\d+/); week = m ? parseInt(m[0]) : 1; }
    else if (typeof v === 'number') week = v;
  }

  const rowsToWrite = [];
  Object.keys(teamPlayers).forEach(teamName => {
    const players = teamPlayers[teamName];
    const g1Op = oppMap[1][teamName] || '';
    const g2Op = oppMap[2][teamName] || '';
    const g3Op = oppMap[3][teamName] || '';
    players.forEach((p, slot) => {
      // Pre-fill score for absent players (RSVP=Out) and explicit fill placeholders.
      // For absent real players, use their personal avg if available, else league avg.
      // For pure fill placeholders, use league avg.
      // Real present players: leave score blank so they can enter their actual score.
      const isAbsent = !p.isFill && rsvpMap[p.name] === 'Out';
      let prefillScore = '';
      if (p.isFill) {
        prefillScore = leagueAvg;
      } else if (isAbsent) {
        const personalAvg = avgMap[p.name];
        prefillScore = personalAvg !== undefined ? Math.round(personalAvg) : leagueAvg;
      }
      // Pre-fill scores only when the team actually plays that round (opp is set)
      const g1Score = (p.isFill || isAbsent) && g1Op ? prefillScore : '';
      const g2Score = (p.isFill || isAbsent) && g2Op ? prefillScore : '';
      const g3Score = (p.isFill || isAbsent) && g3Op ? prefillScore : '';
      rowsToWrite.push([
        season, week, teamName, slot, p.name,
        g1Score, g2Score, g3Score,
        g1Op, g2Op, g3Op,
        p.isFill
      ]);
    });
  });
  if (rowsToWrite.length) {
    active.getRange(2, 1, rowsToWrite.length, ACTIVE_HEADERS.length).setValues(rowsToWrite);
  }

  // ALSO write to Current Week sheet for backward compatibility (best-effort, supports up to 4 teams of 3)
  if (cw && numTeams === 4) {
    const t1 = teamPlayers['Team 1'].map(p => p.name);
    const t2 = teamPlayers['Team 2'].map(p => p.name);
    const t3 = teamPlayers['Team 3'].map(p => p.name);
    const t4 = teamPlayers['Team 4'].map(p => p.name);
    const writeNames = (startRow, startCol, names) => {
      for (let i = 0; i < 3; i++) cw.getRange(startRow + i, startCol).setValue(names[i] || '');
    };
    writeNames(6, 1, t1); writeNames(6, 5, t3);
    writeNames(11, 1, t2); writeNames(11, 5, t4);
    writeNames(19, 1, t4); writeNames(19, 5, t1);
    writeNames(24, 1, t3); writeNames(24, 5, t2);
    ['C6:C8','G6:G8','C11:C13','G11:G13','C19:C21','G19:G21','C24:C26','G24:G26'].forEach(rng => cw.getRange(rng).clearContent());
  }

  return sendJSON({ status: 'success', numTeams, schedule });
}

function archiveAndAdvance(ss, params) {
  const cw = ss.getSheetByName(SHEETS.CURRENT);
  const stats = ensureSheet(ss, SHEETS.STATS, STATS_HEADERS);
  const active = ss.getSheetByName(SHEETS.ACTIVE);

  const season = parseInt(getSetting(ss, 'CurrentSeason', 1)) || 1;
  // Get week — prefer Active Week if it has rows, else Current Week A1
  let week = 1;
  let weekCellVal = null;
  if (cw) {
    weekCellVal = cw.getRange('A1').getValue();
    let w = weekCellVal;
    if (typeof w === 'string') { const m = w.match(/\d+/); w = m ? parseInt(m[0]) : 1; }
    if (typeof w === 'number' && w) week = w;
  }

  // If Active Week has data for this week, use it. Otherwise fall back to Current Week sheet.
  const playerData = {};

  if (active && active.getLastRow() > 1) {
    // Read from Active Week structured rows
    const aData = active.getDataRange().getValues();
    for (let i = 1; i < aData.length; i++) {
      const r = aData[i];
      const name = r[AW.NAME];
      if (!name) continue;
      const team = r[AW.TEAM];
      const g1 = r[AW.G1] === '' ? '' : parseInt(r[AW.G1]) || 0;
      const g2 = r[AW.G2] === '' ? '' : parseInt(r[AW.G2]) || 0;
      const g3 = r[AW.G3] === '' ? '' : parseInt(r[AW.G3]) || 0;
      const g1Opp = r[AW.G1_OPP] || '';
      const g2Opp = r[AW.G2_OPP] || '';
      const g3Opp = r[AW.G3_OPP] || '';
      const isFill = r[AW.IS_FILL] === true || r[AW.IS_FILL] === 'TRUE' || r[AW.IS_FILL] === 1;
      playerData[name + '|' + team + '|' + r[AW.SLOT]] = {
        name, team, g1, g2, g3, g1Opp, g2Opp, g3Opp, isFill
      };
    }
  } else if (cw) {
    // Legacy fallback - read Current Week sheet
    const teams = readCurrentWeekTeams(cw);
    function addP(name, team, gameNum, score, oppTeam) {
      if (!name) return;
      const key = name + '|' + team + '|legacy';
      if (!playerData[key]) playerData[key] = { name, team, g1: '', g1Opp: '', g2: '', g2Opp: '', g3: '', g3Opp: '', isFill: false };
      if (gameNum === 1) { playerData[key].g1 = score; playerData[key].g1Opp = oppTeam; }
      else { playerData[key].g2 = score; playerData[key].g2Opp = oppTeam; }
    }
    teams.t1.forEach(p => addP(p.name, 'Team 1', 1, p.scoreG1, 'Team 3'));
    teams.t3.forEach(p => addP(p.name, 'Team 3', 1, p.scoreG1, 'Team 1'));
    teams.t2.forEach(p => addP(p.name, 'Team 2', 1, p.scoreG1, 'Team 4'));
    teams.t4.forEach(p => addP(p.name, 'Team 4', 1, p.scoreG1, 'Team 2'));
    teams.t4g2.forEach(p => addP(p.name, 'Team 4', 2, p.scoreG2, 'Team 1'));
    teams.t1g2.forEach(p => addP(p.name, 'Team 1', 2, p.scoreG2, 'Team 4'));
    teams.t3g2.forEach(p => addP(p.name, 'Team 3', 2, p.scoreG2, 'Team 2'));
    teams.t2g2.forEach(p => addP(p.name, 'Team 2', 2, p.scoreG2, 'Team 3'));
  } else {
    return sendJSON({ error: 'No active or current week data found' });
  }

  // Compute team totals per round (g1/g2/g3) - all 3 rounds may exist for 3-team/5-team configs
  const teamTotals = { g1: {}, g2: {}, g3: {} };
  Object.values(playerData).forEach(p => {
    teamTotals.g1[p.team] = (teamTotals.g1[p.team] || 0) + (parseInt(p.g1) || 0);
    teamTotals.g2[p.team] = (teamTotals.g2[p.team] || 0) + (parseInt(p.g2) || 0);
    teamTotals.g3[p.team] = (teamTotals.g3[p.team] || 0) + (parseInt(p.g3) || 0);
  });
  function getOutcome(myTeam, oppTeam, gameTotals) {
    const me = gameTotals[myTeam] || 0, opp = gameTotals[oppTeam] || 0;
    if (me > opp) return 'W'; if (me < opp) return 'L'; return 'T';
  }

  const rsvpSheet = ss.getSheetByName(SHEETS.RSVP);
  const rsvpMap = {};
  if (rsvpSheet) {
    const r = rsvpSheet.getDataRange().getValues();
    for (let i = 1; i < r.length; i++) if (r[i][0]) rsvpMap[r[i][0]] = r[i][1];
  }

  // Build archive rows — SKIP fill players (don't archive placeholder scores as stats)
  // For 3-game nights (3-team or 5-team configs), each player only played 2 of 3 game-slots.
  // We consolidate their actual played games into the archive's G1/G2 columns to keep schema.
  const rows = [];
  Object.values(playerData).forEach(p => {
    if (p.isFill) return;  // don't archive league avg placeholders

    // Collect this player's actually-played games (each is {score, opp, outcomeTotals, label})
    const played = [];
    [
      { score: p.g1, opp: p.g1Opp, totals: teamTotals.g1 },
      { score: p.g2, opp: p.g2Opp, totals: teamTotals.g2 },
      { score: p.g3, opp: p.g3Opp, totals: teamTotals.g3 }
    ].forEach(slot => {
      const sc = parseInt(slot.score) || 0;
      if (sc > 0 && slot.opp) played.push({ score: sc, opp: slot.opp, totals: slot.totals });
    });

    const arcG1 = played[0] ? played[0].score : 0;
    const arcG1Opp = played[0] ? played[0].opp : '';
    const arcG2 = played[1] ? played[1].score : 0;
    const arcG2Opp = played[1] ? played[1].opp : '';
    // If 3 games played, G3 score and W/L still factor into Pins / Wins / Losses / Games aggregates
    const arcG3 = played[2] ? played[2].score : 0;

    const games = played.length;
    const pins = arcG1 + arcG2 + arcG3;
    let wins = 0, losses = 0;
    played.forEach(pl => {
      const o = getOutcome(p.team, pl.opp, pl.totals);
      if (o === 'W') wins++; else if (o === 'L') losses++;
    });

    const present = (rsvpMap[p.name] === 'Out') ? false : true;
    rows.push([
      season, week, p.name, p.team,
      arcG1 || '', arcG1Opp, arcG2 || '', arcG2Opp,
      pins, wins, losses, games, present
    ]);
  });

  if (rows.length) stats.getRange(stats.getLastRow() + 1, 1, rows.length, STATS_HEADERS.length).setValues(rows);

  const skipBump = params && params.skipAdvance;
  if (!skipBump) {
    if (cw) {
      const nextWeek = (typeof weekCellVal === 'string' && weekCellVal.toLowerCase().includes('week'))
        ? `Week ${week + 1}` : (week + 1);
      cw.getRange('A1').setValue(nextWeek);
      ['C6:C8','G6:G8','C11:C13','G11:G13','C19:C21','G19:G21','C24:C26','G24:G26'].forEach(rng => cw.getRange(rng).clearContent());
    }
    // Clear Active Week
    if (active) {
      const aLastRow = active.getLastRow();
      if (aLastRow > 1) active.getRange(2, 1, aLastRow - 1, ACTIVE_HEADERS.length).clearContent();
    }
  }
  return sendJSON({ status: 'success', rowsAdded: rows.length, week, season });
}

function readCurrentWeekTeams(cw) {
  const data = cw.getDataRange().getValues();
  const safe = (r, c) => (data[r] && data[r][c] !== undefined) ? data[r][c] : '';
  return {
    t1:   [5,6,7].map(i => ({ name: safe(i, 0), scoreG1: parseInt(safe(i, 2)) || 0 })).filter(p => p.name),
    t3:   [5,6,7].map(i => ({ name: safe(i, 4), scoreG1: parseInt(safe(i, 6)) || 0 })).filter(p => p.name),
    t2:   [10,11,12].map(i => ({ name: safe(i, 0), scoreG1: parseInt(safe(i, 2)) || 0 })).filter(p => p.name),
    t4:   [10,11,12].map(i => ({ name: safe(i, 4), scoreG1: parseInt(safe(i, 6)) || 0 })).filter(p => p.name),
    t4g2: [18,19,20].map(i => ({ name: safe(i, 0), scoreG2: parseInt(safe(i, 2)) || 0 })).filter(p => p.name),
    t1g2: [18,19,20].map(i => ({ name: safe(i, 4), scoreG2: parseInt(safe(i, 6)) || 0 })).filter(p => p.name),
    t3g2: [23,24,25].map(i => ({ name: safe(i, 0), scoreG2: parseInt(safe(i, 2)) || 0 })).filter(p => p.name),
    t2g2: [23,24,25].map(i => ({ name: safe(i, 4), scoreG2: parseInt(safe(i, 6)) || 0 })).filter(p => p.name)
  };
}

function endSeason(ss, params) {
  const stats = ss.getSheetByName(SHEETS.STATS);
  if (!stats) return sendJSON({ error: 'Weekly Scores not found' });
  const history = ensureSheet(ss, SHEETS.HISTORY, ['Season', 'Champion(s)', 'Champion Avg', 'Wins', 'Date Ended', 'Notes']);
  const champsSheet = ensureSheet(ss, SHEETS.CHAMPIONS, ['Season', 'Player']);

  const seasonNum = parseInt(getSetting(ss, 'CurrentSeason', 1)) || 1;
  let champNames = [], champAvg = 0, champWins = 0;
  const data = stats.getDataRange().getValues();

  if (params && Array.isArray(params.champions) && params.champions.length) {
    champNames = params.champions.filter(Boolean);
    let totalPins = 0, totalGames = 0, totalWins = 0;
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[SC.PLAYER] || !champNames.includes(r[SC.PLAYER])) continue;
      if (parseInt(r[SC.SEASON]) !== seasonNum) continue;
      if (r[SC.PRESENT] !== true && r[SC.PRESENT] !== 'TRUE' && r[SC.PRESENT] !== 1) continue;
      totalPins += parseInt(r[SC.PINS]) || 0;
      totalGames += parseInt(r[SC.GAMES]) || 0;
      totalWins += parseInt(r[SC.WINS]) || 0;
    }
    champAvg = totalGames ? totalPins / totalGames : 0;
    champWins = totalWins;
  } else {
    const players = {};
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[SC.PLAYER]) continue;
      if (parseInt(r[SC.SEASON]) !== seasonNum) continue;
      if (r[SC.PRESENT] !== true && r[SC.PRESENT] !== 'TRUE' && r[SC.PRESENT] !== 1) continue;
      const name = r[SC.PLAYER];
      if (!players[name]) players[name] = { wins: 0, pins: 0, games: 0 };
      players[name].wins += parseInt(r[SC.WINS]) || 0;
      players[name].pins += parseInt(r[SC.PINS]) || 0;
      players[name].games += parseInt(r[SC.GAMES]) || 0;
    }
    let topWins = -1, topAvg = -1, topName = null;
    Object.keys(players).forEach(n => {
      const p = players[n];
      const avg = p.games ? p.pins / p.games : 0;
      if (p.wins > topWins || (p.wins === topWins && avg > topAvg)) { topName = n; topWins = p.wins; topAvg = avg; }
    });
    if (topName) { champNames = [topName]; champAvg = topAvg; champWins = topWins; }
  }

  history.appendRow(['Season ' + seasonNum, champNames.join(', '), champAvg.toFixed(1), champWins, new Date(), params && params.notes ? params.notes : '']);
  champNames.forEach(name => champsSheet.appendRow([seasonNum, name]));
  setSetting(ss, 'CurrentSeason', seasonNum + 1);

  const cw = ss.getSheetByName(SHEETS.CURRENT);
  if (cw) {
    const cur = cw.getRange('A1').getValue();
    cw.getRange('A1').setValue(typeof cur === 'string' ? 'Week 1' : 1);
  }
  return sendJSON({ status: 'success', champions: champNames, season: seasonNum, newSeason: seasonNum + 1 });
}

function postToBoard(ss, params) {
  const sheet = ensureSheet(ss, SHEETS.BOARD, ['Timestamp', 'Author', 'Message', 'ID']);
  const id = Utilities.getUuid().substring(0, 8);
  sheet.appendRow([new Date(), params.author, params.message, id]);
  return sendJSON({ status: 'success', id });
}
function deleteBoardPost(ss, params) {
  const sheet = ss.getSheetByName(SHEETS.BOARD);
  if (!sheet) return sendJSON({ error: 'Board not found' });
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === params.id) { sheet.deleteRow(i + 1); return sendJSON({ status: 'success' }); }
  }
  return sendJSON({ error: 'Post not found' });
}
function updateSetting(ss, params) {
  setSetting(ss, params.key, params.value);
  return sendJSON({ status: 'success' });
}

// Update notes/blurb for a given season in League History
function updateSeasonNotes(ss, params) {
  const sheet = ss.getSheetByName(SHEETS.HISTORY);
  if (!sheet) return sendJSON({ error: 'League History sheet not found' });
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return sendJSON({ error: 'No history rows yet' });

  const headers = data[0].map(h => String(h).toLowerCase());
  // Find Season col + Notes col
  let seasonCol = headers.indexOf('season');
  let notesCol = headers.indexOf('notes');
  if (seasonCol === -1) seasonCol = 0;
  if (notesCol === -1) {
    // Add a Notes column at the end
    notesCol = data[0].length;
    sheet.getRange(1, notesCol + 1).setValue('Notes').setFontWeight('bold');
  }

  const target = String(params.season).trim();
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    const cell = String(data[i][seasonCol]).trim();
    // Match either "Season 1" or "1"
    if (cell === target || cell === 'Season ' + target || cell.replace(/season\s*/i, '') === target) {
      rowIdx = i + 1; break;
    }
  }
  if (rowIdx === -1) return sendJSON({ error: 'Season ' + target + ' not in League History yet. Run End Season first or add a row.' });

  sheet.getRange(rowIdx, notesCol + 1).setValue(params.notes || '');
  return sendJSON({ status: 'success', season: target });
}

function setupAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEETS.RSVP, ['Player', 'Status', 'Note', 'Updated']);
  ensureSheet(ss, SHEETS.BOARD, ['Timestamp', 'Author', 'Message', 'ID']);
  ensureSheet(ss, SHEETS.HISTORY, ['Season', 'Champion(s)', 'Champion Avg', 'Wins', 'Date Ended', 'Notes']);
  ensureSheet(ss, SHEETS.CHAMPIONS, ['Season', 'Player']);

  // Active Week: force header refresh in case schema changed (we added G3 columns in v6.3)
  const active = ensureSheet(ss, SHEETS.ACTIVE, ACTIVE_HEADERS);
  const activeHeaders = active.getRange(1, 1, 1, Math.max(active.getLastColumn(), ACTIVE_HEADERS.length)).getValues()[0];
  let needsHeaderRefresh = false;
  ACTIVE_HEADERS.forEach((h, i) => { if (activeHeaders[i] !== h) needsHeaderRefresh = true; });
  if (needsHeaderRefresh) {
    // Clear all existing rows (schema migration) and rewrite headers
    const lr = active.getLastRow();
    if (lr > 1) active.getRange(2, 1, lr - 1, Math.max(active.getLastColumn(), ACTIVE_HEADERS.length)).clearContent();
    active.getRange(1, 1, 1, ACTIVE_HEADERS.length).setValues([ACTIVE_HEADERS]);
    active.getRange(1, 1, 1, ACTIVE_HEADERS.length).setFontWeight('bold').setBackground('#1c1c21').setFontColor('#e8ff47');
  }

  const settings = ensureSheet(ss, SHEETS.SETTINGS, ['Key', 'Value']);

  const sData = settings.getDataRange().getValues();
  const existing = {};
  for (let i = 1; i < sData.length; i++) existing[sData[i][0]] = true;
  const defaults = [['CurrentSeason', 1], ['LeagueName', 'Pindejos Bowling'], ['BowlingNight', 'Tuesday']];
  defaults.forEach(d => { if (!existing[d[0]]) settings.appendRow(d); });

  const stats = ss.getSheetByName(SHEETS.STATS);
  let warnings = '';
  if (!stats) {
    warnings = '\n\nMISSING: Weekly Scores. Create with columns:\n' + STATS_HEADERS.join(' | ');
  } else {
    const headers = stats.getRange(1, 1, 1, Math.max(stats.getLastColumn(), STATS_HEADERS.length)).getValues()[0];
    const missing = [];
    STATS_HEADERS.forEach((h, i) => {
      if (headers[i] !== h) missing.push(`Col ${String.fromCharCode(65 + i)} should be "${h}" (currently "${headers[i] || 'empty'}")`);
    });
    if (missing.length) warnings = '\n\nWeekly Scores schema issues:\n' + missing.join('\n');
  }

  const required = [SHEETS.ROSTER, SHEETS.GENERATED, SHEETS.CURRENT];
  const missingReq = required.filter(s => !ss.getSheetByName(s));

  let msg = 'Setup complete.\n\nReady:\n• Weekly RSVP\n• Trash Board\n• League History\n• Season Champions\n• Active Week\n• Settings';
  if (missingReq.length) msg += '\n\nMissing existing sheets:\n• ' + missingReq.join('\n• ');
  msg += warnings;
  msg += '\n\nNext: populate Season Champions for past winners.\nSeason 1 winners: CJ, Troy, Nick (one row each)';

  // Alert only works from the Sheets editor, not as a Web App — try it, fall back to Logger
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch(e) {
    Logger.log(msg);
  }
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1c1c21').setFontColor('#e8ff47');
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    }
  } else if (headers && headers.length && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}