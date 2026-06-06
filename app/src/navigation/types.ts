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
  PinsinoAccounting: undefined
}

export type StandingsStackParamList = {
  StandingsList: undefined
  PlayerDetail: { name: string }
}

export type PinsinoStackParamList = {
  PinsinoHome: undefined
  PinsinoLeaderboard: undefined
  Sportsbook: undefined
  PlayerPinsino: { playerId: string; name: string }
}
