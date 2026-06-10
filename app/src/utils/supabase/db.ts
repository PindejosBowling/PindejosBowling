import { supabase } from './client'
import type { TablesInsert, TablesUpdate, Json } from './database.types'
import { HIGHLIGHT_EVENT_TYPES } from '../activityFeedTemplates'

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
  // Players registered for a given season (inner join → only registered rows).
  listBySeason: (seasonId: string) =>
    supabase
      .from('players')
      .select('*, registrations!inner(season_id)')
      .eq('registrations.season_id', seasonId)
      .order('name'),
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
  setPayment: (seasonId: string, playerId: string, payment_received: boolean) =>
    supabase.from('registrations').update({ payment_received }).eq('season_id', seasonId).eq('player_id', playerId),
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
  // Superset query backing the consolidated History screen — covers both
  // computeStandingsFromSupabase (needs players.id, week_id, season_id, week_number)
  // and computePastGamesFromSupabase (needs team_number, bowled_at, weeks.id).
  listForHistory: () =>
    supabase
      .from('scores')
      .select(
        'game_id, score,' +
        'team_slots!inner(id, player_id, team_id, is_fill,' +
          'players(id, name),' +
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
  // The team a player is assigned to for a given week (drives "Your Team" on the
  // moneyline board). Null if they aren't slotted that week.
  getTeamForPlayerWeek: (playerId: string, weekId: string) =>
    supabase
      .from('team_slots')
      .select('team_id, teams!inner(week_id)')
      .eq('player_id', playerId)
      .eq('teams.week_id', weekId)
      .maybeSingle(),
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
  // Chains .select() so callers (e.g. the week editor) get the new slot ids back.
  insert: (data: TablesInsert<'team_slots'> | TablesInsert<'team_slots'>[]) =>
    supabase.from('team_slots').insert(data).select(),
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
  // Active (open + closed-for-betting) moneyline markets for a week. Subject is a
  // game (the matchup), so the player-subject embed in MARKET_GRAPH resolves null;
  // the row label comes from the market title + the team-named selections.
  listActiveMoneylineByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'moneyline')
      .in('status', ['open', 'closed'])
      .order('game_number'),
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
  // Same open/close toggle for a week+game's moneyline markets (run alongside the
  // O/U toggle when a game starts/reopens — both close so the board goes inert).
  setMoneylineStatusByWeekGame: (weekId: string, gameNumber: number, status: 'open' | 'closed') =>
    supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'moneyline')
      .eq('game_number', gameNumber)
      .eq('status', status === 'closed' ? 'open' : 'closed'),
  // RSVP-driven create/refund of O/U markets (SECURITY DEFINER, server-side).
  // extraGames adds schedule game numbers not yet present (team-gen game 3); RSVP
  // passes none and the RPC defaults the target set to the established games / {1,2}.
  syncOUForWeek: (weekId: string, extraGames: number[] = []) =>
    supabase.rpc('sync_over_under_markets_for_week', { p_week_id: weekId, p_extra_games: extraGames }),
  // Schedule-driven create of even-money moneyline markets (one per games row),
  // SECURITY DEFINER. Run on team generation / when a game is added, not on RSVP.
  syncMoneylineForWeek: (weekId: string) =>
    supabase.rpc('sync_moneyline_markets_for_week', { p_week_id: weekId }),
  // Admin: refund every bet on a week+game's O/U markets and drop the markets —
  // the inverse of syncOUForWeek's create, used when a schedule game is removed.
  removeOUForGame: (weekId: string, gameNumber: number) =>
    supabase.rpc('remove_over_under_markets_for_game', { p_week_id: weekId, p_game_number: gameNumber }),
  // Admin: settle one market against the subject's actual score.
  settle: (marketId: string, resultValue: number) =>
    supabase.rpc('settle_market', { p_market_id: marketId, p_result_value: resultValue }),
  // Admin: settle one moneyline market from its game's scores (winner = higher
  // combined team total; tie → push). No score input — derived server-side.
  settleMoneyline: (marketId: string) =>
    supabase.rpc('settle_moneyline_market', { p_market_id: marketId }),
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
  // All bets with a leg on an over_under or moneyline market in this week (Active Bets).
  listByWeek: (weekId: string) =>
    supabase
      .from('bets')
      .select(
        '*, players(name), bet_legs!inner(*, bet_selections!inner(*, ' +
        'bet_markets!inner(*, subject:players!bet_markets_subject_player_id_fkey(name))))'
      )
      .eq('bet_legs.bet_selections.bet_markets.week_id', weekId)
      .in('bet_legs.bet_selections.bet_markets.market_type', ['over_under', 'moneyline'])
      .order('placed_at', { ascending: false }),
  // All settled bets for a season (Settled Bets), with leg → selection → market(+week).
  listSettledBySeason: (seasonId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('season_id', seasonId)
      .not('settled_at', 'is', null)
      .order('settled_at', { ascending: false }),
  // One bet with its full leg → selection → market graph (Bet Details overlay,
  // e.g. opened from a Market Moves placement card).
  getById: (betId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('id', betId)
      .single(),
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
  // Active + paid-off loans in a season with player + product — the admin
  // cancel list, which can roll back loans that have already been repaid.
  listCancelableDetailed: (seasonId: string) =>
    supabase
      .from('loans')
      .select('*, players(name), loan_products(display_name, borrow_amount)')
      .eq('season_id', seasonId)
      .in('status', ['active', 'paid_off'])
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
  // Debt rows for active + paid-off loans in a season — summed per loan for the
  // admin cancel list (paid-off loans net to 0).
  listCancelableBySeason: (seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('player_id, amount, loan_id, loans!inner(status)')
      .eq('season_id', seasonId)
      .in('loans.status', ['active', 'paid_off']),
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
  contractType: string                 // 'line_duel' | 'prop_duel' | 'head_to_head' | 'custom'
  counterpartyId: string | null        // null = open board
  weekId: string
  gameNumber: number | null            // required for line/head_to_head; null for prop/custom
  creatorStake: number                 // the creator's own stake
  counterpartyStake: number            // the opponent's stake (equal to creator's unless custom)
  propMarketId: string | null          // prop_duel only
  creatorSelection: string | null      // prop_duel only ('over' | 'under')
  message: string | null
  customTitle: string | null           // custom only
  customDescription: string | null     // custom only — the admin-judged win condition
  creatorHandicap: number              // head_to_head only (signed pins; 0 = none)
  counterpartyHandicap: number         // head_to_head only (signed pins; 0 = none)
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
  creatorHandicap: number              // role-fixed; head_to_head only (signed pins)
  counterpartyHandicap: number         // role-fixed; head_to_head only (signed pins)
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

  // Admin: active/locked + still-negotiating + settled contracts for the season.
  // Settled contracts are included so an admin can review and cancel them.
  listLockedBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES)
      .eq('season_id', seasonId)
      .in('status', ['pending', 'countered', 'locked', 'settled'])
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
      p_creator_handicap: a.creatorHandicap,
      p_counterparty_handicap: a.counterpartyHandicap,
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
      p_creator_handicap: a.creatorHandicap,
      p_counterparty_handicap: a.counterpartyHandicap,
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

// ── Bounty Board (bounty_post → bounty_hunter_stakes / bounty_settlements / ──────
//    bounty_payouts) ────────────────────────────────────────────────────────────
// Public, pooled, manually-settled sponsor/house bounties with early-hunter
// anti-dilution + a House seed. Lifecycle-only rows; escrow lives directly on
// pin_ledger tagged with bounty_post_id. All player write paths (create-sponsor /
// enter) and admin tools (create-house / close / settle / cancel) go through
// SECURITY DEFINER RPCs. The single players FK on bounty_post is disambiguated by
// its constraint name; bounty_hunter_stakes / bounty_payouts use the implicit embed.
const BOUNTY_SPONSOR = 'sponsor:players!bounty_post_sponsor_player_id_fkey(name)'

export interface CreateBountyArgs {
  weekId: string
  title: string
  description: string
  rewardPerHunter: number              // R — what each hunter wins
  hunterStakeAmount: number            // H — what each hunter risks
  maxHunters: number                   // m — caps the sponsor's escrow at R*m
  closesAt: string                     // ISO timestamp (computed app-side, design §11)
}

export const bountyPosts = {
  // Public board: open bounties accepting hunters, current season.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', ' +
              'bounty_hunter_stakes(id, player_id, entry_number, protected_hunter_profit, stake_amount, status)')
      .eq('season_id', seasonId)
      .eq('status', 'open')
      .order('created_at', { ascending: false }),

  // Everything involving this player (sponsored or hunted) for the season.
  // The .or() across the embedded relation filters the embed, not the parent, so
  // it's bucketed client-side; the broad season fetch keeps it to one round trip.
  listByPlayerSeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),

  // Admin: bounties to manage for the season (filter client-side by status/type/week).
  listBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),

  // Detail: one bounty with hunters, settlement, and payouts.
  getById: (bountyId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', ' +
              'bounty_hunter_stakes(*, players(name)), ' +
              'bounty_settlements(*), bounty_payouts(*, players(name))')
      .eq('id', bountyId).single(),

  createSponsor: (a: CreateBountyArgs) =>
    supabase.rpc('create_sponsor_bounty', {
      p_week_id: a.weekId,
      p_title: a.title,
      p_description: a.description,
      p_reward_per_hunter: a.rewardPerHunter,
      p_hunter_stake_amount: a.hunterStakeAmount,
      p_max_hunters: a.maxHunters,
      p_closes_at: a.closesAt,
    }),
  createHouse: (a: CreateBountyArgs) =>
    supabase.rpc('create_house_bounty', {
      p_week_id: a.weekId,
      p_title: a.title,
      p_description: a.description,
      p_reward_per_hunter: a.rewardPerHunter,
      p_hunter_stake_amount: a.hunterStakeAmount,
      p_max_hunters: a.maxHunters,
      p_closes_at: a.closesAt,
    }),
  enter: (bountyId: string) => supabase.rpc('enter_bounty_as_hunter', { p_bounty_post_id: bountyId }),
  close: (bountyId: string) => supabase.rpc('close_bounty', { p_bounty_post_id: bountyId }),
  settle: (bountyId: string, outcome: 'sponsor_win' | 'hunter_win', reasoning: string) =>
    supabase.rpc('settle_bounty', {
      p_bounty_post_id: bountyId,
      p_outcome: outcome,
      p_admin_settlement_reasoning: reasoning,
    }),
  cancel: (bountyId: string) => supabase.rpc('cancel_bounty', { p_bounty_post_id: bountyId }),
}

// Bounty-related ledger rows are plain pin_ledger rows tagged with bounty_post_id.
export const bountyLedger = {
  listByPost: (bountyId: string) =>
    supabase.from('pin_ledger').select('*, players(name)')
      .eq('bounty_post_id', bountyId)
      .order('created_at', { ascending: false }),
}

// ── Activity Feed ("Market Moves") — activity_feed_events ────────────────────
// The public economic newswire. One narrative row per feed-worthy economic
// action; the feed never moves pins (read-derived only). Copy is rendered in the
// app from template_key + public_payload (see utils/activityFeedTemplates.ts) —
// names are pulled live from the joined players rows, NOT snapshotted. Three FKs
// point at players, so the actor/subject/secondary embeds REQUIRE explicit
// !constraint hints to disambiguate.
// Feed copy uses first names only (e.g. "Garrett placed a ticket"), so the embeds
// pull first_name (+ avatar_path for the actor's avatar) rather than full name.
const FEED_GRAPH =
  '*, actor:players!activity_feed_events_actor_player_id_fkey(first_name, avatar_path), ' +
  'subject:players!activity_feed_events_subject_player_id_fkey(first_name), ' +
  'secondary:players!activity_feed_events_secondary_player_id_fkey(first_name)'

// Keyset cursor = the last row's { publishedAt, id }. published_at DESC, id DESC
// is the stable ordering key; the .or(...) keeps the boundary row from repeating.
type FeedCursor = { publishedAt: string; id: string }
const feedCursorFilter = (c: FeedCursor) =>
  `published_at.lt.${c.publishedAt},and(published_at.eq.${c.publishedAt},id.lt.${c.id})`

export const activityFeed = {
  // Public feed (design §15.1) — published + public rows, newest first.
  listPublic: (seasonId: string, cursor?: FeedCursor) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Feature filter (design §15.2): sourceFeature in ('sportsbook','loan_shark').
  listByFeature: (seasonId: string, sourceFeature: string, cursor?: FeedCursor) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .eq('source_feature', sourceFeature)
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Highlights filter (design §15.2). Importance is app-owned (not a DB column),
  // so we filter by the event types the Market Moves feature deems highlight/major
  // (HIGHLIGHT_EVENT_TYPES, derived from importanceForEvent).
  listHighlights: (seasonId: string, cursor?: FeedCursor) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .in('event_type', HIGHLIGHT_EVENT_TYPES)
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Admin: every row (any status/visibility) for the season, filtered client-side.
  listAllForAdmin: (seasonId: string) =>
    supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId)
      .order('published_at', { ascending: false }).order('id', { ascending: false }).limit(200),

  suppress: (eventId: string, reason: string) =>
    supabase.rpc('suppress_activity_event', { p_event_id: eventId, p_reason: reason }),
  restore: (eventId: string) =>
    supabase.rpc('restore_activity_event', { p_event_id: eventId }),
  createSystemEvent: (args: {
    sourceFeature: 'system' | 'admin'; eventType: string; templateKey: string
    publicPayload: Json
  }) =>
    supabase.rpc('create_system_activity_event', {
      p_source_feature: args.sourceFeature,
      p_event_type: args.eventType,
      p_template_key: args.templateKey,
      p_public_payload: args.publicPayload,
    }),
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

// ── Lanetalk imports ────────────────────────────────────────────────────────
// One row per parsed game from a Lanetalk "shared session" link. Writes happen
// server-side in the `lanetalk-import` Edge Function (fetch → parse → fuzzy-match
// the bowler to a slotted player → classify Official/Recreational by score);
// the app only invokes it and reads the results (admin-gated via RLS).

/** Per-game line in the Edge Function's response summary. */
export interface LanetalkImportGameSummary {
  gameNumber: number
  score: number | null
  classification: 'official' | 'recreational'
}

/** Shape returned by the `lanetalk-import` Edge Function. */
export interface LanetalkImportSummary {
  ok: boolean
  weekResolved?: boolean
  weekId?: string
  matchedPlayer?: string | null
  games?: LanetalkImportGameSummary[]
  officialCount?: number
  recreationalCount?: number
  message?: string
  /** Failure stage tag from the Edge Function (e.g. 'fetch_status', 'auth_not_admin'). */
  stage?: string
  /** Per-request id — present on every response; grep the function logs by it. */
  reqId?: string
  /** Stage-specific diagnostics (status, bodySnippet, parsed player/date, etc.). */
  debug?: Record<string, unknown>
}

export const lanetalkImports = {
  // Invoke the Edge Function to fetch, parse, match and write a link's games.
  // The function returns recoverable failures as 200 { ok:false, … } but auth
  // (403) and server (500) failures as non-2xx — for those, supabase-js puts a
  // generic FunctionsHttpError in `error` and the real JSON body (with stage /
  // message / debug) on error.context. Normalize both into one summary so the
  // caller always sees the function's actual message and diagnostics.
  run: async (url: string): Promise<LanetalkImportSummary> => {
    const { data, error } = await supabase.functions.invoke<LanetalkImportSummary>(
      'lanetalk-import', { body: { url } },
    )
    if (error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        try {
          const body = await ctx.json()
          if (body && typeof body === 'object') return body as LanetalkImportSummary
        } catch { /* body wasn't JSON — fall through to the generic message */ }
      }
      return { ok: false, stage: 'invoke', message: error.message ?? 'Import failed' }
    }
    return data ?? { ok: false, stage: 'invoke', message: 'Import failed (empty response)' }
  },
  listRecent: () =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name)')
      .order('created_at', { ascending: false })
      .limit(200),
  listBySourceUrl: (url: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name)')
      .eq('source_url', url)
      .order('game_number'),
  // Every imported game for one player, oldest first — frame-level game details.
  // Note: lanetalk_game_imports RLS is admin-read-only, so non-admins get zero
  // rows (which also hides the "Game Details" entry point on PlayerDetail).
  listByPlayer: (playerId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('game_number, score, played_at, source_url, classification, payload')
      .eq('player_id', playerId)
      .order('played_at', { ascending: true, nullsFirst: true })
      .order('game_number', { ascending: true }),
  // Whether a player has any imported games — drives the PlayerDetail entry point.
  countByPlayer: (playerId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
}
