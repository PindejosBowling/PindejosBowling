export type MoreStackParamList = {
  MoreHome: undefined
  LeagueRecords: undefined
  HeadToHead: undefined
  Chemistry: undefined
  PastSeasons: undefined
  TrashBoard: undefined
  Playoffs: undefined
  PlayerManagement: undefined
  ProfilePictures: undefined
  PastGames: undefined
  Registration: undefined
  PinsinoAdmin: undefined
}

export type StandingsStackParamList = {
  StandingsList: undefined
  PlayerDetail: { name: string }
}

export type BettingStackParamList = {
  BettingHome: undefined
  PlayerBettingDetail: { playerId: string; name: string }
}
