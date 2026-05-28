function generateBalancedTeams() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName("Roster Avgs");
  const teamSheet = ss.getSheetByName("Generated Teams");
  
  if (!rosterSheet || !teamSheet) {
    SpreadsheetApp.getUi().alert("Error: Ensure tabs are named 'Roster Avgs' and 'Generated Teams'");
    return;
  }

  const leagueAvg = rosterSheet.getRange("K2").getValue();
  const fillPreference = rosterSheet.getRange("L2").getValue(); 
  const lastRow = rosterSheet.getLastRow();
  if (lastRow < 2) return;
  
  const data = rosterSheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const memberNames = data.map(row => row[0]).filter(name => name !== "");
  const dropdownRule = SpreadsheetApp.newDataValidation().requireValueInList(memberNames).setAllowInvalid(false).build();

  let realPlayers = [];
  let miaPlayers = [];

  data.forEach(row => {
    let p = { name: row[0], status: row[1], avg: row[4] || leagueAvg };
    if (p.status === "Available") { realPlayers.push(p); } 
    else { miaPlayers.push(p); }
  });

  realPlayers.sort((a, b) => b.avg - a.avg);
  miaPlayers.sort((a, b) => b.avg - a.avg);

  const numTeams = 4;
  let teams = Array.from({length: numTeams}, () => []);

  let forward = true;
  let teamIdx = 0;
  
  // Phase 1: Real Players
  realPlayers.forEach(p => {
    teams[teamIdx].push(p);
    if (forward) { teamIdx++; if (teamIdx === numTeams) { teamIdx = numTeams - 1; forward = false; } } 
    else { teamIdx--; if (teamIdx < 0) { teamIdx = 0; forward = true; } }
  });

  // Phase 2: MIA Players
  miaPlayers.forEach(p => {
    teams[teamIdx].push(p);
    if (forward) { teamIdx++; if (teamIdx === numTeams) { teamIdx = numTeams - 1; forward = false; } } 
    else { teamIdx--; if (teamIdx < 0) { teamIdx = 0; forward = true; } }
  });

  teamSheet.clear();
  teamSheet.getRange("A1").setValue("Team Builder Dashboard").setFontWeight("bold").setFontSize(14);
  teamSheet.getRange("D1").setValue("Fill Mode: " + fillPreference).setFontStyle("italic");
  
  let currRow = 3;

  teams.forEach((team, i) => {
    let teamStartRow = currRow + 1;
    let teamEndRow = currRow + team.length;

    teamSheet.getRange(currRow, 1).setValue(`Team ${i + 1}`);
    teamSheet.getRange(currRow, 2).setFormula(`=SUM(B${teamStartRow}:B${teamEndRow})`);
    teamSheet.getRange(currRow, 1, 1, 3).setFontWeight("bold").setBackground("#eeeeee");
    
    currRow++;

    team.forEach(p => {
      let nameCell = teamSheet.getRange(currRow, 1);
      let avgCell = teamSheet.getRange(currRow, 2);
      let statusCell = teamSheet.getRange(currRow, 3);

      nameCell.setValue(p.name).setDataValidation(dropdownRule);
      
      // Status VLOOKUP
      statusCell.setFormula(`=IFERROR(VLOOKUP(A${currRow}, 'Roster Avgs'!A:B, 2, FALSE), "Unknown")`);

      // Average Logic based on Fill Mode and Status
      avgCell.setFormula(`=IF( AND('Roster Avgs'!$L$2="League Avg", C${currRow}="Unavailable"), 'Roster Avgs'!$K$2, IFERROR(VLOOKUP(A${currRow}, 'Roster Avgs'!A:E, 5, FALSE), 'Roster Avgs'!$K$2) )`);

      if (p.status === "Unavailable") nameCell.setBackground("#f4cccc");
      currRow++;
    });
    currRow++; 
  });

  teamSheet.autoResizeColumns(1, 3);
}