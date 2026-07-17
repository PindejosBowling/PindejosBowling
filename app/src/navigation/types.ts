export type MoreStackParamList = {
  MoreHome: undefined
  LeagueRecords: undefined
  HeadToHead: undefined
  Chemistry: undefined
  History: undefined
  TrashBoard: undefined
  Playoffs: undefined
  PlayerManagement: undefined
  ProfilePictures: undefined
  Registration: undefined
  RegistrationAdmin: undefined
  SeasonRegistration: undefined
  PinsinoAdmin: undefined
  PinsinoAccounting: undefined
  AdminSportsbook: undefined
  LoanSharkAdmin: undefined
  PvPAdmin: undefined
  MarketMovesAdmin: undefined
  BountyAdmin: undefined
  AuctionHouseAdmin: undefined
  Archives: undefined
  LanetalkImportAdmin: undefined
  NotificationSettings: undefined
  BroadcastAdmin: undefined
  RsvpBonusAdmin: undefined
  AppVersionAdmin: undefined
}

export type StandingsStackParamList = {
  StandingsList: undefined
  PlayerDetail: { name: string }
  FrameStats: { name: string; playerId: string }
}

export type PinsinoStackParamList = {
  PinsinoHome: undefined
  PinsinoHelp: undefined
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
  AuctionHouse: undefined
  AuctionDetail: { auctionId: string }
}
