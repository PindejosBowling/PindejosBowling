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
  RegistrationAdmin: undefined
  SeasonRegistration: undefined
  PinsinoAdmin: undefined
  PinsinoAccounting: undefined
  PinsinoSportsbook: undefined
  LoanSharkAdmin: undefined
  PvPAdmin: undefined
  MarketMovesAdmin: undefined
  BountyAdmin: undefined
}

export type StandingsStackParamList = {
  StandingsList: undefined
  PlayerDetail: { name: string }
}

export type PinsinoStackParamList = {
  PinsinoHome: undefined
  PinsinoLeaderboard: undefined
  Sportsbook: undefined
  LoanShark: undefined
  PlayerPinsino: { playerId: string; name: string }
  PvP: undefined
  PvPBoard: undefined
  PvPCreate: { opponentId?: string; rematchOfId?: string; openBoard?: boolean } | undefined
  MarketMoves: undefined
  BountyBoard: undefined
  BountyCreate: undefined
  BountyDetail: { bountyId: string }
}
