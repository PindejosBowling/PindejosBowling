# File Map

```
app/
├── App.tsx                      # Root: font loading, prefs hydration, navigation container
├── index.ts                     # Expo entry point
├── src/
│   ├── theme.ts                 # colors, fonts, radius
│   ├── hooks/
│   │   ├── usePinsinoData.ts    # Balance + open lines + bets for PinsinoScreen/PinsinoLeaderboardScreen/SportsbookScreen (+ normalizeBet, BetView, LeaderboardEntry with debt/netWorth)
│   │   ├── usePlayerPinsinoData.ts  # One player's balance/ledger/bets (+ shared LedgerEntry type)
│   │   ├── useHousePinsinoData.ts  # House-side ledger + summary/P&L/stats for PinsinoAccountingScreen + AdminSportsbookScreen
│   │   ├── useLoanSharkData.ts  # Borrower hook: balance, available products, active loan + payment history
│   │   ├── useChemistryData.ts  # Chemistry data + computeChemistryFromSupabase
│   │   ├── useH2HData.ts        # H2H data + computeH2HFromSupabase
│   │   ├── useLeagueRecordsData.ts  # League records + computeLeagueRecordsFromSupabase
│   │   ├── useMatchupsData.ts   # Active week matchup data (full derivation in hook)
│   │   ├── usePastGamesData.ts  # Past games by season + computePastGamesFromSupabase
│   │   ├── usePastSeasonsData.ts  # Past seasons raw data (screen reuses computeStandingsFromSupabase)
│   │   ├── usePlayerDetailData.ts   # Player data + many compute* functions
│   │   ├── usePlayerManagementData.ts  # Raw player list for PlayerManagementScreen
│   │   ├── useRegistrationData.ts  # Registrations + seasons + roster for RegistrationScreen
│   │   ├── useRefresh.ts        # useRefresh(fn) — RefreshControl helper
│   │   └── useStandingsData.ts  # Standings data + computeStandingsFromSupabase
│   ├── navigation/
│   │   ├── RootNavigator.tsx    # Bottom tab navigator
│   │   ├── StandingsStackNavigator.tsx  # Stack: StandingsList → PlayerDetail
│   │   ├── PinsinoStackNavigator.tsx    # Stack: PinsinoHome → PinsinoLeaderboard / Sportsbook / PlayerPinsino
│   │   ├── MoreStackNavigator.tsx       # Stack: MoreHome + tools (incl. PinsinoAdmin → PinsinoAccounting / AdminSportsbook)
│   │   └── types.ts             # MoreStackParamList, StandingsStackParamList, PinsinoStackParamList
│   ├── stores/
│   │   ├── pendingStore.ts      # Optimistic edit buffer (scores, RSVPs, team gen state)
│   │   ├── uiStore.ts           # Ephemeral UI state + toast queue
│   │   └── avatarStore.ts       # Signed-URL cache for player profile pictures
│   ├── utils/
│   │   ├── badges.ts            # BADGE_RULES + badgesForPlayer — status→emoji rule list (see Player Badges)
│   │   ├── helpers.ts           # initials, timeAgo, combinations, spreadAndML
│   │   └── supabase/
│   │       ├── client.ts        # Supabase client (env-var configured)
│   │       ├── database.types.ts # Auto-generated Postgres types
│   │       └── db.ts            # Typed query objects per table
│   ├── components/
│   │   ├── AppHeader.tsx
│   │   ├── PlayerAvatar.tsx
│   │   ├── PlayerBadges.tsx
│   │   ├── ScreenHeader.tsx
│   │   ├── Toast.tsx
│   │   ├── ConfirmBar.tsx
│   │   ├── PillFilter.tsx
│   │   ├── ToggleGroup.tsx
│   │   ├── PlayerScoreRow.tsx
│   │   ├── OddsBlock.tsx
│   │   ├── LineRow.tsx           # One market row; data-driven selection buttons (see Betting Line Board)
│   │   ├── LineRowContainer.tsx  # Collapsible per-category section; pinned rows stay visible collapsed (see Betting Line Board)
│   │   ├── CustomLineRow.tsx     # One admin custom line ("special"): title/desc/legs + single TAKE button (see Betting Line Board)
│   │   ├── CustomLineCreateModal.tsx       # Admin create/edit sheet for custom lines (leg builder + week-scope picker)
│   │   ├── CustomLineAdminActionModal.tsx  # Admin per-line actions: edit / enable-disable / delete
│   │   ├── BetRow.tsx            # One bet/parlay row in betting lists (see Betting display components)
│   │   ├── ActiveBetsView.tsx    # Shared Active Bets surface (read-only on Pinsino, actionable on PinsinoAdmin)
│   │   ├── SettledBetsView.tsx   # Shared Settled Bets surface (read-only on Pinsino, cancellable on PinsinoAdmin)
│   │   ├── SettleBetModal.tsx    # Admin single-market settlement overlay (settle_market RPC)
│   │   ├── LedgerRow.tsx         # One pin_ledger activity row, shared by both ledger screens
│   │   ├── BetDetailModal.tsx    # Shared "Bet Details" overlay + resultBadge/betReturnText helpers
│   │   ├── PinsinoLeaderboardTable.tsx  # Shared leaderboard table (rank, name, balance, debt, net worth, upside); limit prop for preview
│   │   ├── LoadingView.tsx
│   │   ├── HistoricalTeamBlock.tsx
│   │   ├── ProfileMenuModal.tsx
│   │   ├── PlayerPickerModal.tsx
│   │   ├── AdminArchiveModal.tsx
│   │   ├── AdminEndSeasonModal.tsx
│   │   ├── AdminOpenRegistrationModal.tsx
│   │   └── AdminGenerateTeamsModal.tsx
│   └── screens/
│       ├── LoginScreen.tsx          # Phone OTP login flow
│       ├── MatchupsScreen.tsx       # Live scoreboard + score entry
│       ├── RsvpScreen.tsx           # Weekly attendance management
│       ├── StandingsScreen.tsx      # Season/all-time standings table
│       ├── MoreHomeScreen.tsx       # Tile grid for tools/admin
│       ├── PlayerDetailScreen.tsx   # Per-player stats, game log, records
│       ├── PlayerManagementScreen.tsx  # Add/edit/toggle players (admin)
│       ├── ProfilePicturesScreen.tsx  # Upload/delete player profile photos (admin)
│       ├── PastGamesScreen.tsx      # Historical week rosters + scores by season
│       ├── RegistrationScreen.tsx   # Per-season sign-ups + admin registration management
│       ├── LeagueRecordsScreen.tsx  # High game/series/team records
│       ├── HeadToHeadScreen.tsx     # 1v1 player comparison
│       ├── ChemistryScreen.tsx      # Pair/trio win-rate analysis
│       ├── PastSeasonsScreen.tsx    # Past seasons — season-by-season summary
│       ├── PinsinoScreen.tsx        # Hub: balance card + top-3 leaderboard preview + tile menu (Sportsbook)
│       ├── PinsinoLeaderboardScreen.tsx  # Full pin-balance leaderboard (Titans of Pindustry)
│       ├── SportsbookScreen.tsx     # Public betting: Place Bets / Active Bets / Settled Bets toggle
│       ├── PlayerPinsinoScreen.tsx  # One player's betting record: Activity / Open / Settled
│       ├── PinsinoAdminScreen.tsx   # Admin hub: tile menu (Accounting + Sportsbook + Loan Shark)
│       ├── PinsinoAccountingScreen.tsx  # Admin: House Balance + Activity / Weekly P&L toggle
│       ├── AdminSportsbookScreen.tsx  # Admin: Active Bets / Settled Bets toggle (settle + cancel actions)
│       ├── LoanSharkScreen.tsx      # Borrower: active loan panel or product list + borrow confirmation modal
│       ├── LoanSharkAdminScreen.tsx # Admin: active loans list + cancel action
│       ├── TrashBoardScreen.tsx     # Fun message board
│       └── PlayoffsScreen.tsx       # Admin: playoffs bracket
```
