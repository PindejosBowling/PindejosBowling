function archiveWeeklyScores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scorecard = ss.getSheetByName("Current Week"); 
  const database = ss.getSheetByName("Weekly Scores"); 
  
  if (!scorecard || !database) {
    SpreadsheetApp.getUi().alert("Error: Check sheet names 'Current Week' and 'Weekly Scores'");
    return;
  }

  const weekValue = scorecard.getRange("A1").getValue(); 
  const weekNum = weekValue.toString().replace(/\D/g, ""); 

  // 1. CALCULATE TEAM TOTALS FOR MATCHUPS
  const t1_g1 = getSum(scorecard, "C6:C8");
  const t3_g1 = getSum(scorecard, "G6:G8");
  const t2_g1 = getSum(scorecard, "C11:C13");
  const t4_g1 = getSum(scorecard, "G11:G13");

  const t4_g2 = getSum(scorecard, "C19:C21");
  const t1_g2 = getSum(scorecard, "G19:G21");
  const t3_g2 = getSum(scorecard, "C24:C26");
  const t2_g2 = getSum(scorecard, "G24:G26");

  // 2. PROCESS PLAYER DATA
  // Structure: [NameRange, StatusRange, G1Range, G2Range, TeamLabel]
  const mapping = [
    {n: "A6:A8",   s: "B6:B8",   g1: "C6:C8",   g2: "G19:G21", team: "Team 1"},
    {n: "A11:A13", s: "B11:B13", g1: "C11:C13", g2: "G24:G26", team: "Team 2"},
    {n: "E6:E8",   s: "F6:F8",   g1: "G6:G8",   g2: "A24:C26", team: "Team 3"},
    {n: "E11:E13", s: "F11:F13", g1: "G11:G13", g2: "A19:C21", team: "Team 4"}
  ];

  let rowsToSave = [];

  mapping.forEach(block => {
    let names = scorecard.getRange(block.n).getValues().flat();
    let statuses = scorecard.getRange(block.s).getValues().flat();
    let g1s = scorecard.getRange(block.g1).getValues().flat();
    let g2s = scorecard.getRange(block.g2).getValues().flat();

    names.forEach((name, i) => {
      // SKIP if the name is empty OR the status is "Unavailable"
      if (!name || statuses[i] === "Unavailable") return;

      let s1 = Number(g1s[i]) || 0;
      let s2 = Number(g2s[i]) || 0;
      let totalPins = s1 + s2;
      let w = 0; let l = 0;

      // Win/Loss Logic (Matches your League Matchups)
      if (block.team === "Team 1") {
        (t1_g1 > t3_g1) ? w++ : l++; (t1_g2 > t4_g2) ? w++ : l++;
      } else if (block.team === "Team 2") {
        (t2_g1 > t4_g1) ? w++ : l++; (t2_g2 > t3_g2) ? w++ : l++;
      } else if (block.team === "Team 3") {
        (t3_g1 > t1_g1) ? w++ : l++; (t3_g2 > t2_g2) ? w++ : l++;
      } else if (block.team === "Team 4") {
        (t4_g1 > t2_g1) ? w++ : l++; (t4_g2 > t1_g2) ? w++ : l++;
      }

      let totalGames = w + l;

      // Order: Week, Name, Team, G1, G2, Total Pins, Wins, Losses, Total Games
      rowsToSave.push([weekNum, name, block.team, s1, s2, totalPins, w, l, totalGames]);
    });
  });

  // 3. WRITE TO DATABASE
  if (rowsToSave.length > 0) {
    database.getRange(database.getLastRow() + 1, 1, rowsToSave.length, 9).setValues(rowsToSave);
  }

  // 4. CREATE SNAPSHOT (Before Reset)
  let snapshotName = weekValue;
  if (!ss.getSheetByName(snapshotName)) {
    let snapshot = scorecard.copyTo(ss).setName(snapshotName);
    let range = snapshot.getDataRange();
    range.setValues(range.getValues());
  }

  // 5. RESET SCORECARD FORMULAS
  // Game 1
  scorecard.getRange("A6:C8").setFormulas([
    ["='Generated Teams'!A4", "='Generated Teams'!C4", "=IF(B6=\"Unavailable\",'Generated Teams'!B4,0)"],
    ["='Generated Teams'!A5", "='Generated Teams'!C5", "=IF(B7=\"Unavailable\",'Generated Teams'!B5,0)"],
    ["='Generated Teams'!A6", "='Generated Teams'!C6", "=IF(B8=\"Unavailable\",'Generated Teams'!B6,0)"]
  ]);
  scorecard.getRange("E6:G8").setFormulas([
    ["='Generated Teams'!A14", "='Generated Teams'!C14", "=IF(F6=\"Unavailable\",'Generated Teams'!B14,0)"],
    ["='Generated Teams'!A15", "='Generated Teams'!C15", "=IF(F7=\"Unavailable\",'Generated Teams'!B15,0)"],
    ["='Generated Teams'!A16", "='Generated Teams'!C16", "=IF(F8=\"Unavailable\",'Generated Teams'!B16,0)"]
  ]);
  scorecard.getRange("A11:C13").setFormulas([
    ["='Generated Teams'!A9", "='Generated Teams'!C9", "=IF(B11=\"Unavailable\",'Generated Teams'!B9,0)"],
    ["='Generated Teams'!A10", "='Generated Teams'!C10", "=IF(B12=\"Unavailable\",'Generated Teams'!B10,0)"],
    ["='Generated Teams'!A11", "='Generated Teams'!C11", "=IF(B13=\"Unavailable\",'Generated Teams'!B11,0)"]
  ]);
  scorecard.getRange("E11:G13").setFormulas([
    ["='Generated Teams'!A19", "='Generated Teams'!C19", "=IF(F11=\"Unavailable\",'Generated Teams'!B19,0)"],
    ["='Generated Teams'!A20", "='Generated Teams'!C20", "=IF(F12=\"Unavailable\",'Generated Teams'!B20,0)"],
    ["='Generated Teams'!A21", "='Generated Teams'!C21", "=IF(F13=\"Unavailable\",'Generated Teams'!B21,0)"]
  ]);

  // Game 2
  scorecard.getRange("A19:C21").setFormulas([
    ["='Generated Teams'!A19", "='Generated Teams'!C19", "=IF(B19=\"Unavailable\",'Generated Teams'!B19,0)"],
    ["='Generated Teams'!A20", "='Generated Teams'!C20", "=IF(B20=\"Unavailable\",'Generated Teams'!B20,0)"],
    ["='Generated Teams'!A21", "='Generated Teams'!C21", "=IF(B21=\"Unavailable\",'Generated Teams'!B21,0)"]
  ]);
  scorecard.getRange("E19:G21").setFormulas([
    ["='Generated Teams'!A4", "='Generated Teams'!C4", "=IF(F19=\"Unavailable\",'Generated Teams'!B4,0)"],
    ["='Generated Teams'!A5", "='Generated Teams'!C5", "=IF(F20=\"Unavailable\",'Generated Teams'!B5,0)"],
    ["='Generated Teams'!A6", "='Generated Teams'!C6", "=IF(F21=\"Unavailable\",'Generated Teams'!B6,0)"]
  ]);
  scorecard.getRange("A24:C26").setFormulas([
    ["='Generated Teams'!A14", "='Generated Teams'!C14", "=IF(B24=\"Unavailable\",'Generated Teams'!B14,0)"],
    ["='Generated Teams'!A15", "='Generated Teams'!C15", "=IF(B25=\"Unavailable\",'Generated Teams'!B15,0)"],
    ["='Generated Teams'!A16", "='Generated Teams'!C16", "=IF(B26=\"Unavailable\",'Generated Teams'!B16,0)"]
  ]);
  scorecard.getRange("E24:G26").setFormulas([
    ["='Generated Teams'!A9", "='Generated Teams'!C9", "=IF(F24=\"Unavailable\",'Generated Teams'!B9,0)"],
    ["='Generated Teams'!A10", "='Generated Teams'!C10", "=IF(F25=\"Unavailable\",'Generated Teams'!B10,0)"],
    ["='Generated Teams'!A11", "='Generated Teams'!C11", "=IF(F26=\"Unavailable\",'Generated Teams'!B11,0)"]
  ]);

  SpreadsheetApp.getUi().alert("Archived! Only active players were recorded in the database.");
}

function getSum(sheet, range) {
  return sheet.getRange(range).getValues().flat().reduce((a, b) => a + (Number(b) || 0), 0);
}