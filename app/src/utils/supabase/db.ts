import { supabase } from './client'
import type { TablesInsert, TablesUpdate } from './database.types'

export const boardPosts = {
  list: () =>
    supabase
      .from('board_posts')
      .select('*, players(name)')
      .order('created_at', { ascending: false }),
  insert: (data: TablesInsert<'board_posts'>) =>
    supabase.from('board_posts').insert(data),
  remove: (id: string) =>
    supabase.from('board_posts').delete().eq('id', id),
}

export const games = {
  listByWeek: (weekId: string) =>
    supabase
      .from('games')
      .select('*, teams!games_team_a_id_fkey!inner(week_id)')
      .eq('teams.week_id', weekId)
      .order('game_number'),
  listForArchivedWeeks: () =>
    supabase
      .from('games')
      .select('id, game_number, team_a_id, team_b_id, teams!games_team_a_id_fkey!inner(week_id, weeks!inner(is_archived))')
      .eq('teams.weeks.is_archived', true),
  insert: (data: TablesInsert<'games'> | TablesInsert<'games'>[]) =>
    supabase.from('games').insert(data),
  remove: (id: string) =>
    supabase.from('games').delete().eq('id', id),
  // Deleting a week's teams cascades to its games (and slots/scores); see teams.removeByWeek.
  removeByWeekAndGame: async (weekId: string, gameNumber: number) => {
    const { data: teamRows, error: teamErr } = await supabase
      .from('teams').select('id').eq('week_id', weekId)
    if (teamErr) return { data: null, error: teamErr }
    const teamIds = (teamRows ?? []).map(t => t.id)
    if (teamIds.length === 0) return { data: null, error: null }
    return supabase.from('games').delete().eq('game_number', gameNumber).in('team_a_id', teamIds)
  },
}

export const players = {
  list: () =>
    supabase.from('players').select('*').order('name'),
  listActive: () =>
    supabase.from('players').select('*').eq('is_active', true).order('name'),
  getById: (id: string) =>
    supabase.from('players').select('*').eq('id', id).single(),
  getByName: (name: string) =>
    supabase.from('players').select('*').ilike('name', name.trim()).single(),
  getByUserId: (userId: string) =>
    supabase.from('players').select('id, name, role').eq('user_id', userId).maybeSingle(),
  isRegistered: (phone: string) =>
    supabase.rpc('is_registered_player', { phone }),
  insert: (data: TablesInsert<'players'>) =>
    supabase.from('players').insert(data),
  update: (id: string, data: TablesUpdate<'players'>) =>
    supabase.from('players').update(data).eq('id', id),
}

// Player profile pictures live in the private "avatars" bucket.
// Reads require auth → served via short-lived signed URLs; writes are admin-only (storage RLS).
export const avatars = {
  // Upsert a player's photo. `path` is the storage key (e.g. "<playerId>.jpg").
  upload: (path: string, body: ArrayBuffer | Blob, contentType: string) =>
    supabase.storage.from('avatars').upload(path, body, { upsert: true, contentType }),
  remove: (path: string) =>
    supabase.storage.from('avatars').remove([path]),
  // Batch-sign a list of paths in one round-trip (default 1h expiry).
  signedUrls: (paths: string[], expiresIn = 3600) =>
    supabase.storage.from('avatars').createSignedUrls(paths, expiresIn),
}

export const registrations = {
  list: () =>
    supabase.from('registrations').select('*, players(id, name)'),
  listBySeason: (seasonId: string) =>
    supabase.from('registrations').select('*, players(id, name)').eq('season_id', seasonId),
  insert: (data: TablesInsert<'registrations'>) =>
    supabase.from('registrations').insert(data),
  remove: (seasonId: string, playerId: string) =>
    supabase.from('registrations').delete().eq('season_id', seasonId).eq('player_id', playerId),
}

export const rsvp = {
  listByWeek: (weekId: string) =>
    supabase
      .from('rsvp')
      .select('*, players(name)')
      .eq('week_id', weekId),
  upsert: (data: TablesInsert<'rsvp'> | TablesInsert<'rsvp'>[]) =>
    supabase.from('rsvp').upsert(data, { onConflict: 'player_id,week_id' }),
  remove: (id: string) =>
    supabase.from('rsvp').delete().eq('id', id),
  removeByWeek: (weekId: string) =>
    supabase.from('rsvp').delete().eq('week_id', weekId),
}

export const scores = {
  listByWeek: (weekId: string) =>
    supabase
      .from('scores')
      .select('*, team_slots!inner(team_id, slot, player_id, teams!inner(week_id))')
      .eq('team_slots.teams.week_id', weekId),
  listBySeason: (seasonId: string) =>
    supabase
      .from('scores')
      .select('score, team_slots!inner(player_id, is_fill, teams!inner(weeks!inner(season_id, is_archived)))')
      .eq('team_slots.teams.weeks.season_id', seasonId)
      .eq('team_slots.teams.weeks.is_archived', true)
      .eq('team_slots.is_fill', false)
      .not('score', 'is', null),
  listAllArchived: () =>
    supabase
      .from('scores')
      .select('score, team_slots!inner(player_id, is_fill, teams!inner(weeks!inner(is_archived)))')
      .eq('team_slots.teams.weeks.is_archived', true)
      .eq('team_slots.is_fill', false)
      .not('score', 'is', null),
  listForStandings: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score,' +
        'team_slots!inner(id, player_id, team_id, is_fill,' +
          'players(id, name),' +
          'teams!inner(week_id,' +
            'weeks!inner(season_id, week_number, is_archived)' +
          ')' +
        ')'
      )
      .eq('team_slots.teams.weeks.is_archived', true)
      .not('score', 'is', null),
  listForPlayerDetail: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score,' +
        'team_slots!inner(id, player_id, team_id, slot, is_fill,' +
          'players(id, name),' +
          'teams!inner(team_number, week_id,' +
            'weeks!inner(id, season_id, week_number, is_archived,' +
              'seasons!inner(id, number)' +
            ')' +
          ')' +
        ')'
      )
      .eq('team_slots.teams.weeks.is_archived', true)
      .not('score', 'is', null),
  listForH2H: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score,' +
        'team_slots!inner(player_id, team_id, is_fill,' +
          'players(name),' +
          'teams!inner(week_id,' +
            'weeks!inner(week_number, is_archived,' +
              'seasons!inner(number)' +
            ')' +
          ')' +
        ')'
      )
      .eq('team_slots.teams.weeks.is_archived', true)
      .not('score', 'is', null),
  listForLeagueRecords: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score, games!scores_game_id_fkey(game_number),' +
        'team_slots!inner(player_id, team_id, is_fill,' +
          'players(id, name),' +
          'teams!inner(team_number, week_id,' +
            'weeks!inner(season_id, week_number, is_archived,' +
              'seasons!inner(id, number)' +
            ')' +
          ')' +
        ')'
      )
      .eq('team_slots.teams.weeks.is_archived', true)
      .not('score', 'is', null),
  listForPastGames: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score,' +
        'team_slots!inner(player_id, team_id, is_fill,' +
          'players(name),' +
          'teams!inner(team_number, week_id,' +
            'weeks!inner(id, season_id, week_number, bowled_at, is_archived)' +
          ')' +
        ')'
      )
      .eq('team_slots.teams.weeks.is_archived', true)
      .not('score', 'is', null),
  // Used by archive settlement: fetches non-fill scores with game_number for bet resolution.
  listByWeekWithGames: (weekId: string) =>
    supabase
      .from('scores')
      .select(
        'score,' +
        'games!scores_game_id_fkey!inner(game_number),' +
        'team_slots!inner(player_id, is_fill, teams!inner(week_id))'
      )
      .eq('team_slots.teams.week_id', weekId)
      .eq('team_slots.is_fill', false)
      .not('score', 'is', null),
  insert: (data: TablesInsert<'scores'> | TablesInsert<'scores'>[]) =>
    supabase.from('scores').insert(data),
  upsert: (data: TablesInsert<'scores'> | TablesInsert<'scores'>[]) =>
    supabase.from('scores').upsert(data, { onConflict: 'team_slot_id,game_id' }),
  update: (id: string, data: TablesUpdate<'scores'>) =>
    supabase.from('scores').update(data).eq('id', id),
  removeBySlotIds: (ids: string[]) =>
    supabase.from('scores').delete().in('team_slot_id', ids),
  remove: (teamSlotId: string, gameId: string) =>
    supabase.from('scores').delete().eq('team_slot_id', teamSlotId).eq('game_id', gameId),
}

export const seasonChampions = {
  list: () =>
    supabase
      .from('season_champions')
      .select('*, players(name), seasons(number)'),
  listBySeason: (seasonId: string) =>
    supabase
      .from('season_champions')
      .select('*, players(name)')
      .eq('season_id', seasonId),
  insert: (data: TablesInsert<'season_champions'>) =>
    supabase.from('season_champions').insert(data),
  remove: (id: string) =>
    supabase.from('season_champions').delete().eq('id', id),
}

export const seasons = {
  list: () =>
    supabase.from('seasons').select('*').order('number'),
  getLatest: () =>
    supabase
      .from('seasons')
      .select('*')
      .order('number', { ascending: false })
      .limit(1)
      .single(),
  getById: (id: string) =>
    supabase.from('seasons').select('*').eq('id', id).single(),
  // The current playing season: active and no longer in registration. A
  // newly-created season sits in registration (registration_open=true,
  // is_active=false) and must NOT be treated as current just for having the
  // highest number — use this instead of getLatest() for "what season is it now".
  getCurrent: () =>
    supabase
      .from('seasons')
      .select('*')
      .eq('is_active', true)
      .eq('registration_open', false)
      .order('number', { ascending: false })
      .limit(1)
      .single(),
  // Most recently ended season (is_active=false, not in registration).
  // Used to look up champions for the champion bonus when a new season opens.
  getLastEnded: () =>
    supabase
      .from('seasons')
      .select('*')
      .eq('is_active', false)
      .eq('registration_open', false)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  insert: (data: TablesInsert<'seasons'>) =>
    supabase.from('seasons').insert(data),
  update: (id: string, data: TablesUpdate<'seasons'>) =>
    supabase.from('seasons').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('seasons').delete().eq('id', id),
  // Admin: pay down active loans at season close (min(balance, debt)) before the
  // season is marked ended, so final standings reflect post-settlement net worth.
  settleLoansForClose: (seasonId: string) =>
    supabase.rpc('settle_loans_for_season_close', { p_season_id: seasonId }),
}

export const teams = {
  listByWeek: (weekId: string) =>
    supabase
      .from('teams')
      .select('*')
      .eq('week_id', weekId)
      .order('team_number'),
  insert: (data: TablesInsert<'teams'> | TablesInsert<'teams'>[]) =>
    supabase.from('teams').insert(data).select(),
  removeByWeek: (weekId: string) =>
    supabase.from('teams').delete().eq('week_id', weekId),
}

export const teamSlots = {
  listByWeek: (weekId: string) =>
    supabase
      .from('team_slots')
      .select('*, players(name), teams!inner(team_number, week_id)')
      .eq('teams.week_id', weekId)
      .order('team_id')
      .order('slot'),
  listByPlayer: (playerId: string) =>
    supabase
      .from('team_slots')
      .select(
        'id, team_id, slot, is_fill,' +
        'teams!inner(team_number, week_id,' +
          'weeks!inner(id, season_id, week_number, is_archived,' +
            'seasons!inner(id, number)' +
          ')' +
        ')'
      )
      .eq('player_id', playerId)
      .eq('teams.weeks.is_archived', true),
  insert: (data: TablesInsert<'team_slots'> | TablesInsert<'team_slots'>[]) =>
    supabase.from('team_slots').insert(data),
  update: (id: string, data: TablesUpdate<'team_slots'>) =>
    supabase.from('team_slots').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('team_slots').delete().eq('id', id),
  // No week-scoped delete: deleting a week's teams cascades to its slots (see teams.removeByWeek).
}

// ── Target betting model (markets → selections → bets → legs) ───────────────
// The canonical over/under model. A market is one player×game×week O/U; its two
// selections ('over'/'under') share a line. A bet is a stake with one bet_leg
// per selection (single leg for O/U). Player write paths (place/cancel) and all
// admin lifecycle steps go through SECURITY DEFINER RPCs; reads embed the whole
// market/selection/leg graph in one round-trip. Subject embeds disambiguate the
// two players FKs on bet_markets via the constraint name.
const MARKET_GRAPH =
  '*, subject:players!bet_markets_subject_player_id_fkey(name), bet_selections(*)'
// Leg → selection → market(+subject, +week) graph, embedded under a bet.
const LEG_GRAPH =
  'bet_legs(*, bet_selections(*, bet_markets(*, subject:players!bet_markets_subject_player_id_fkey(name), weeks(week_number, seasons(number)))))'

export const betMarkets = {
  // Open over_under markets for a week (Place Bets), with selections + subject.
  listOpenOUByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .eq('status', 'open')
      .order('game_number')
      .order('subject_player_id'),
  // Active (open + closed-for-betting) over_under markets for a week, with
  // selections + subject. Closed markets are games "in progress" — still shown on
  // Place Bets (disabled) but no longer bettable. Excludes settled/void.
  listActiveOUByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .in('status', ['open', 'closed'])
      .order('game_number')
      .order('subject_player_id'),
  // game_number + status for a week's O/U markets — used to derive which games are
  // "in progress" (closed for betting) without pulling the full market graph.
  listOUStatusByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select('game_number, status')
      .eq('week_id', weekId)
      .eq('market_type', 'over_under'),
  // Start/reopen a game's betting: flip every O/U market for a week+game between
  // 'open' and 'closed' in one admin write. Closing blocks new bets (place_house_bet
  // rejects non-open selections) but leaves settlement intact (settle_betting_for_week
  // settles any market with status <> 'settled').
  setOUStatusByWeekGame: (weekId: string, gameNumber: number, status: 'open' | 'closed') =>
    supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .eq('game_number', gameNumber)
      .eq('status', status === 'closed' ? 'open' : 'closed'),
  // RSVP-driven create/refund of O/U markets (SECURITY DEFINER, server-side).
  // extraGames adds schedule game numbers not yet present (team-gen game 3); RSVP
  // passes none and the RPC defaults the target set to the established games / {1,2}.
  syncOUForWeek: (weekId: string, extraGames: number[] = []) =>
    supabase.rpc('sync_over_under_markets_for_week', { p_week_id: weekId, p_extra_games: extraGames }),
  // Admin: refund every bet on a week+game's O/U markets and drop the markets —
  // the inverse of syncOUForWeek's create, used when a schedule game is removed.
  removeOUForGame: (weekId: string, gameNumber: number) =>
    supabase.rpc('remove_over_under_markets_for_game', { p_week_id: weekId, p_game_number: gameNumber }),
  // Admin: settle one market against the subject's actual score.
  settle: (marketId: string, resultValue: number) =>
    supabase.rpc('settle_market', { p_market_id: marketId, p_result_value: resultValue }),
  // Admin: credit scores + settle all open markets for an archived week.
  settleForWeek: (weekId: string) =>
    supabase.rpc('settle_betting_for_week', { p_week_id: weekId }),
}

export const bets = {
  // A player's bets with leg → selection → market(+subject), newest first.
  listByPlayer: (playerId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('player_id', playerId)
      .order('placed_at', { ascending: false }),
  // All bets with a leg on an over_under market in this week (Active Bets).
  listByWeek: (weekId: string) =>
    supabase
      .from('bets')
      .select(
        '*, players(name), bet_legs!inner(*, bet_selections!inner(*, ' +
        'bet_markets!inner(*, subject:players!bet_markets_subject_player_id_fkey(name))))'
      )
      .eq('bet_legs.bet_selections.bet_markets.week_id', weekId)
      .eq('bet_legs.bet_selections.bet_markets.market_type', 'over_under')
      .order('placed_at', { ascending: false }),
  // All settled bets for a season (Settled Bets), with leg → selection → market(+week).
  listSettledBySeason: (seasonId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('season_id', seasonId)
      .not('settled_at', 'is', null)
      .order('settled_at', { ascending: false }),
  // Place a house bet atomically (SECURITY DEFINER); O/U passes one selection id.
  place: (selectionIds: string[], stake: number) =>
    supabase.rpc('place_house_bet', { p_selection_ids: selectionIds, p_stake: stake }),
  // Admin: total undo of a placed bet (removes ledger rows + bet, re-opens market).
  cancel: (betId: string) =>
    supabase.rpc('cancel_bet', { p_bet_id: betId }),
}

// ── Loan Shark (loan_products → loans → loan_ledger) ────────────────────────
// Immutable historical loan offers; a loan is lifecycle-only (balance derived
// from loan_ledger SUM(amount)). All player write paths (take/repay) and admin
// cancel go through SECURITY DEFINER RPCs; reads embed the product graph.
export const loanProducts = {
  list: () =>
    supabase.from('loan_products').select('*').order('sort_order'),
  // is_active filter only; full availability (window, max_uses, season) is
  // re-checked server-side in take_loan.
  listAvailable: () =>
    supabase.from('loan_products').select('*').eq('is_active', true).order('sort_order'),
}

export const loans = {
  // A player's loans (any status) with their product, newest first.
  listByPlayer: (playerId: string) =>
    supabase
      .from('loans')
      .select('*, loan_products(*)')
      .eq('player_id', playerId)
      .order('issued_at', { ascending: false }),
  // Active loans in a season (id + player) — feeds the net-worth leaderboard.
  listActiveBySeason: (seasonId: string) =>
    supabase
      .from('loans')
      .select('id, player_id')
      .eq('season_id', seasonId)
      .eq('status', 'active'),
  // Active loans in a season with player + product (admin list).
  listActiveDetailed: (seasonId: string) =>
    supabase
      .from('loans')
      .select('*, players(name), loan_products(display_name, borrow_amount)')
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .order('issued_at', { ascending: false }),
  take: (productId: string) =>
    supabase.rpc('take_loan', { p_loan_product_id: productId }),
  repay: (loanId: string, amount: number) =>
    supabase.rpc('repay_loan', { p_loan_id: loanId, p_amount: amount }),
  // Admin: destructive rollback — removes the loan's pin + debt rows and the loan.
  cancel: (loanId: string) =>
    supabase.rpc('cancel_loan', { p_loan_id: loanId }),
}

export const loanLedger = {
  // A player's debt event history for a season (newest first) — the borrower's
  // payment history. SUM(amount) over a loan's rows = outstanding debt.
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('*, weeks(week_number)')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
  // All debt rows for active loans in a season — summed per player for the
  // net-worth leaderboard's Debt column.
  listActiveBySeason: (seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('player_id, amount, loan_id, loans!inner(status)')
      .eq('season_id', seasonId)
      .eq('loans.status', 'active'),
}

export const pinLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('*, weeks(week_number), bets(*, players(name), ' + LEG_GRAPH + ')')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
  // House-side rows for a season (the betting counterparty + bonus funder).
  // Admin-only screen; RLS already permits authenticated SELECT on all rows.
  listHouseBySeason: (seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('*, weeks(week_number), bets(*, players(name), ' + LEG_GRAPH + ')')
      .eq('season_id', seasonId)
      .eq('is_house', true)
      .order('created_at', { ascending: false }),
  // Leaderboard is player balances only — exclude house rows (player_id IS NULL).
  listBySeasonForLeaderboard: (seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('player_id, amount, type, created_at, players(name, is_active)')
      .eq('season_id', seasonId)
      .eq('is_house', false),
  insert: (data: TablesInsert<'pin_ledger'> | TablesInsert<'pin_ledger'>[]) =>
    supabase.from('pin_ledger').insert(data),
}

// ── PvP Challenge Contracts (pvp_challenges → pvp_challenge_offers / pvp_ledger) ─
// Player-vs-player duels escrowed at acceptance; winner takes the whole pot (no
// rake). Lifecycle-only contract rows (escrow derived from pvp_ledger); all player
// write paths (create/counter/accept/decline) and admin tools (cancel/void/settle)
// go through SECURITY DEFINER RPCs. Reads embed the creator/counterparty names —
// the two FKs to players are disambiguated via their constraint names.
export interface CreatePvpArgs {
  contractType: string                 // 'line_duel' | 'prop_duel' | 'raw_score_duel' | 'custom'
  counterpartyId: string | null        // null = open board
  weekId: string
  gameNumber: number | null            // required for line/raw; null for prop/custom
  creatorStake: number                 // the creator's own stake
  counterpartyStake: number            // the opponent's stake (equal to creator's unless custom)
  propMarketId: string | null          // prop_duel only
  creatorSelection: string | null      // prop_duel only ('over' | 'under')
  message: string | null
  customTitle: string | null           // custom only
  customDescription: string | null     // custom only — the admin-judged win condition
}

export interface CounterPvpArgs {
  challengeId: string
  creatorStake: number                 // role-fixed (creator side), not viewer-relative
  counterpartyStake: number            // role-fixed (counterparty side)
  contractType: string
  gameNumber: number | null
  propMarketId: string | null
  selection: string | null
  message: string | null
}

const CHALLENGE_PARTIES =
  '*, creator:players!pvp_challenges_creator_player_id_fkey(name), ' +
  'counterparty:players!pvp_challenges_counterparty_player_id_fkey(name)'

export const pvpChallenges = {
  // Inbox: everything involving this player for the current season, with a light
  // offer embed so the hook can tell whose turn it is (latest live offer's offerer).
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES +
        ', pvp_challenge_offers(offered_by_player_id, offer_no, superseded_at, accepted_at, declined_at)')
      .eq('season_id', seasonId)
      .or(`creator_player_id.eq.${playerId},counterparty_player_id.eq.${playerId}`)
      .order('created_at', { ascending: false }),

  // Open Challenge Board: open contracts awaiting any taker.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name)')
      .eq('season_id', seasonId)
      .is('counterparty_player_id', null)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

  // Admin: active/locked + still-negotiating contracts for the season.
  listLockedBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES)
      .eq('season_id', seasonId)
      .in('status', ['pending', 'countered', 'locked'])
      .order('created_at', { ascending: false }),

  // Detail page: one contract with its full negotiation trail + ledger.
  getById: (challengeId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES +
        ', pvp_challenge_offers(*, offerer:players!pvp_challenge_offers_offered_by_player_id_fkey(name)), ' +
        'pvp_ledger(*, weeks(week_number))')
      .eq('id', challengeId).single(),

  create: (a: CreatePvpArgs) =>
    supabase.rpc('create_pvp_challenge', {
      p_contract_type: a.contractType,
      p_counterparty_player_id: a.counterpartyId as string,
      p_week_id: a.weekId,
      p_game_number: a.gameNumber as number,
      p_creator_stake: a.creatorStake,
      p_counterparty_stake: a.counterpartyStake,
      p_prop_market_id: a.propMarketId as string,
      p_creator_selection: a.creatorSelection as string,
      p_message: a.message as string,
      p_custom_title: a.customTitle as string,
      p_custom_description: a.customDescription as string,
    }),
  counter: (a: CounterPvpArgs) =>
    supabase.rpc('counter_pvp_challenge', {
      p_challenge_id: a.challengeId,
      p_creator_stake: a.creatorStake,
      p_counterparty_stake: a.counterpartyStake,
      p_contract_type: a.contractType,
      p_game_number: a.gameNumber as number,
      p_prop_market_id: a.propMarketId as string,
      p_selection: a.selection as string,
      p_message: a.message as string,
    }),
  // The Line Duel snapshot value for a player (floor(season avg)+0.5; league-avg
  // fallback). Used to preview each side's line-to-beat during create/counter
  // before it's frozen onto the contract.
  projectedLine: (playerId: string, seasonId: string) =>
    supabase.rpc('pvp_player_line', { p_player_id: playerId, p_season_id: seasonId }),
  accept: (challengeId: string) =>
    supabase.rpc('accept_pvp_challenge', { p_challenge_id: challengeId }),
  decline: (challengeId: string) =>
    supabase.rpc('decline_pvp_challenge', { p_challenge_id: challengeId }),
  // Admin: close every still-open challenge for a week (optionally one game).
  // Used by "Start Game" (game-scoped) and week settlement (gameNumber = null).
  closeOpenForGame: (weekId: string, gameNumber: number | null) =>
    supabase.rpc('close_open_pvp_challenges', { p_week_id: weekId, p_game_number: gameNumber as number }),
  cancel: (challengeId: string) =>
    supabase.rpc('cancel_pvp_challenge', { p_challenge_id: challengeId }),
  void: (challengeId: string, note: string) =>
    supabase.rpc('void_pvp_challenge', { p_challenge_id: challengeId, p_admin_note: note }),
  settle: (challengeId: string, winnerId: string | null, note: string) =>
    supabase.rpc('settle_pvp_challenge', {
      p_challenge_id: challengeId,
      p_source: 'admin',
      p_winner_player_id: winnerId as string,
      p_admin_note: note,
    }),
}

export const pvpLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_ledger').select('*, weeks(week_number)')
      .eq('player_id', playerId).eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
}

export const weeks = {
  list: () =>
    supabase.from('weeks').select('*').order('week_number'),
  listBySeason: (seasonId: string) =>
    supabase
      .from('weeks')
      .select('*')
      .eq('season_id', seasonId)
      .order('week_number'),
  getCurrent: () =>
    supabase
      .from('weeks')
      .select('*')
      .eq('is_archived', false)
      .order('week_number', { ascending: false })
      .limit(1)
      .single(),
  getActive: () =>
    supabase
      .from('weeks')
      .select('*')
      .eq('is_archived', false)
      .eq('is_confirmed', true)
      .order('week_number', { ascending: false })
      .limit(1)
      .single(),
  getById: (id: string) =>
    supabase.from('weeks').select('*').eq('id', id).single(),
  insert: (data: TablesInsert<'weeks'>) =>
    supabase.from('weeks').insert(data),
  update: (id: string, data: TablesUpdate<'weeks'>) =>
    supabase.from('weeks').update(data).eq('id', id),
}
