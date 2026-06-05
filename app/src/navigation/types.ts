export type MoreStackParamList = {
  MoreHome: undefined
  LeagueRecords: undefined
  HeadToHead: undefined
  Chemistry: undefined
  PastSeasons: undefined
  TrashBoard: undefined
  Playoffs: undefined
  PlayerManagement: undefined
  PastGames: undefined
  Registration: undefined
  BettingAdmin: undefined
}

export type StandingsStackParamList = {
  StandingsList: undefined
  PlayerDetail: { name: string }
}

export type BettingStackParamList = {
  BettingHome: undefined
  PlayerBettingDetail: { playerId: string; name: string }
}
