function testGenerate2x5() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const start = new Date().getTime();
  const result = generateTeamsAction(ss, {
    numTeams: 2,
    teamSize: 5,
    fillToSize: true,
    fillMode: 'League Avg',
    avgSource: 'last-season'
  });
  const elapsed = new Date().getTime() - start;
  Logger.log('Elapsed: ' + elapsed + 'ms');
  Logger.log('Result: ' + result.getContent().substring(0, 500));
}