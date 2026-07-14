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
  // Returns the inserted rows (ids + team ids) so callers can reconcile the
  // participation the games_participation_seed_ins trigger auto-creates.
  insert: (data: TablesInsert<'games'> | TablesInsert<'games'>[]) =>
    supabase.from('games').insert(data).select('id, game_number, team_a_id, team_b_id'),
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
  // Self-service path: the caller RSVPs their OWN row and, if before the weekly
  // deadline, earns a one-time house-funded bonus (see submit_own_rsvp). The
  // player is resolved server-side from auth.uid() — this must NOT be used to
  // RSVP on behalf of another player (admins keep using upsert() for that, which
  // never pays a bonus). Returns { awarded, amount, reason }.
  submitOwn: (weekId: string, status: string) =>
    supabase.rpc('submit_own_rsvp', { p_week_id: weekId, p_status: status }),
  remove: (id: string) =>
    supabase.from('rsvp').delete().eq('id', id),
  removeByWeek: (weekId: string) =>
    supabase.from('rsvp').delete().eq('week_id', weekId),
  // Admin reset: clears a week's RSVPs AND revokes any rsvp_bonus credits it
  // paid (both double-entry sides), in one transaction. SECURITY DEFINER +
  // admin-guarded — use this for the Reset button, not the raw removeByWeek.
  resetForWeek: (weekId: string) =>
    supabase.rpc('reset_rsvp_for_week', { p_week_id: weekId }),
}

// Admin-editable config for the RSVP self-submit bonus (enable, amount, weekly
// deadline). season_id NULL = the global default; v1 only ever seeds/edits that
// row (the per-season override is reserved for later). The award RPC reads this
// server-side; these wrappers back the admin editor + the player deadline banner.
export const rsvpBonusConfig = {
  // The global default row (season_id IS NULL) — the effective config in v1.
  getGlobal: () =>
    supabase.from('rsvp_bonus_config').select('*').is('season_id', null).maybeSingle(),
  update: (id: string, data: TablesUpdate<'rsvp_bonus_config'>) =>
    supabase.from('rsvp_bonus_config').update(data).eq('id', id),
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
  // The season the Pinsino should display: the live season if one is active,
  // otherwise the most-recently-ended season so its final outcome stays visible
  // in the gap between season close and the next season's start. The `concluded`
  // flag lets screens show a "Final Results" banner. Returns null data only
  // before the very first season ever ends.
  getCurrentOrLastEnded: async () => {
    const current = await seasons.getCurrent()
    if (current.data) return { data: current.data, concluded: false }
    const ended = await seasons.getLastEnded()
    return { data: ended.data ?? null, concluded: !!ended.data }
  },
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
  // Active (open + closed-for-betting) prop markets for a week — the LaneTalk
  // stat lines (strikes/spares per game, clean%/first-ball avg per night).
  // Night markets carry game_number null and group under WEEKLY on the board.
  listActivePropByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .in('status', ['open', 'closed'])
      .order('game_number', { nullsFirst: false })
      .order('subject_player_id'),
  // Active (open + closed-for-betting) team_prop markets for a week — team
  // aggregate lines (clean frames / strikes / spares / total pins per game).
  // Anchored by subject_game_id + params.team_id, so the player-subject embed
  // resolves null (like moneyline); the row label comes from params.team_number.
  listActiveTeamPropByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'team_prop')
      .in('status', ['open', 'closed'])
      .order('game_number')
      .order('title'),
  // Active (open + closed-for-betting) markets by id, with selections + subject —
  // any market_type. Used by the "Copy this bet" flow to re-resolve a bet's legs
  // against the CURRENT live markets/selections (odds/lines may have moved since
  // placement). Excludes settled/void, so a copied bet whose market has since
  // settled simply won't resolve.
  getByIds: (ids: string[]) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .in('id', ids)
      .in('status', ['open', 'closed']),
  // Unsettled LaneTalk-clock markets across ALL weeks — the import screen groups
  // these by week to surface its "Confirm LaneTalk Data" button. These ride a
  // separate settlement clock from archive (data lands the next day). Covers
  // both player props (source=lanetalk) and lanetalk-clock team props — the
  // Confirm RPC settles both, so the badge must count both.
  listUnsettledLanetalkProps: () =>
    supabase
      .from('bet_markets')
      .select('id, week_id, game_number, subject_player_id, params, status, title')
      .or('and(market_type.eq.prop,params->>source.eq.lanetalk),and(market_type.eq.team_prop,params->>clock.eq.lanetalk)')
      .in('status', ['open', 'closed']),
  // Week ids that have settled LaneTalk-clock markets — pairs with
  // listUnsettledLanetalkProps so the import screen can mark a week Confirmed
  // (settled, none pending) vs Unconfirmed (some pending) vs no badge (no props).
  listSettledLanetalkPropWeeks: () =>
    supabase
      .from('bet_markets')
      .select('week_id')
      .or('and(market_type.eq.prop,params->>source.eq.lanetalk),and(market_type.eq.team_prop,params->>clock.eq.lanetalk)')
      .eq('status', 'settled'),
  // Start/reopen a game's betting: flip every O/U market for a week+game between
  // 'open' and 'closed' in one admin write. Closing blocks new bets (place_house_bet
  // rejects non-open selections) but leaves settlement intact (settle_betting_for_week
  // settles any market with status <> 'settled').
  // Night total-pins O/U markets (game_number null) ride game 1's toggle, like
  // the night stat props — once the night's bowling starts, night betting closes.
  setOUStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .is('game_number', null)
      .eq('status', from)
  },
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
  // Same open/close toggle for a week+game's stat-prop markets (run alongside the
  // O/U + moneyline toggles when a game starts/reopens). Night-scoped props
  // (game_number null) ride game 1's toggle — once the night's bowling starts,
  // night-stat betting closes too.
  setPropStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .is('game_number', null)
      .eq('status', from)
  },
  // Same open/close toggle for a week+game's team-prop markets (run alongside
  // the other toggles when a game starts/reopens). Night-scoped team props
  // (game_number null) ride game 1's toggle, like the night player props.
  setTeamPropStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'team_prop')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'team_prop')
      .is('game_number', null)
      .eq('status', from)
  },
  // Reopen every closed O/U line for a week. Clear Matchups returns the week to a
  // pre-game state, so Start Game's betting suspension must not survive the reset —
  // surviving lines (both players still RSVP'd in) would otherwise be stranded
  // unbettable with no games row left to expose the reopen toggle.
  // Covers stat props and team props too — they suspend with the games, so the
  // reset must reopen them alongside the O/U lines.
  reopenOUForWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .update({ status: 'open' })
      .eq('week_id', weekId)
      .in('market_type', ['over_under', 'prop', 'team_prop'])
      .eq('status', 'closed'),
  // Create/refund of O/U markets (SECURITY DEFINER, server-side). Line ownership:
  // RSVP owns the lines until the week has teams; the roster (team_slots) owns
  // them after — ineligible subjects and game numbers outside the schedule are
  // pruned (bets refunded whole). DB triggers on rsvp/team_slots/games re-run
  // this sync after any mutation, so explicit calls here are belt-and-braces.
  // extraGames adds schedule game numbers not yet present (team-gen game 3).
  syncOUForWeek: (weekId: string, extraGames: number[] = []) =>
    supabase.rpc('sync_over_under_markets_for_week', { p_week_id: weekId, p_extra_games: extraGames }),
  // Server-side create/prune/reprice of LaneTalk stat-prop markets — same
  // coupling model as the O/U sync (run by the rsvp/team_slots/games/scores
  // resync triggers; explicit calls here are belt-and-braces). Lines are
  // seeded from each player's official imports; no imports → no lines.
  syncLanetalkPropsForWeek: (weekId: string) =>
    supabase.rpc('sync_lanetalk_prop_markets_for_week', { p_week_id: weekId }),
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
  // Admin: settle the week's LaneTalk stat props from imported official games —
  // the "Confirm LaneTalk Data" clock, separate from archive. Actuals are
  // derived server-side from lanetalk_game_imports.payload (the client never
  // supplies a result value). voidMissing deletes markets with no data (the
  // delete-refund rail); otherwise they stay pending for a later re-run.
  // Returns one summary row { settled, voided, left_pending } for the toast.
  settleLanetalkProps: (weekId: string, voidMissing = false) =>
    supabase.rpc('settle_lanetalk_props_for_week', { p_week_id: weekId, p_void_missing: voidMissing }),
}

export const bets = {
  // A player's bets with leg → selection → market(+subject), newest first.
  listByPlayer: (playerId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('player_id', playerId)
      .order('placed_at', { ascending: false }),
  // All bets with a leg on one of this week's markets (Active Bets).
  // Deliberately market-type-agnostic — the week_id filter on the joined
  // market is the whole scope, so new market types flow through with no edit
  // here (a now-removed type enumeration once made prop-only bets vanish and
  // truncated mixed parlays' embeds: inner-join filters gate the bet AND
  // prune its embedded legs).
  listByWeek: (weekId: string) =>
    supabase
      .from('bets')
      .select(
        '*, players(name), bet_legs!inner(*, bet_selections!inner(*, ' +
        'bet_markets!inner(*, subject:players!bet_markets_subject_player_id_fkey(name))))'
      )
      .eq('bet_legs.bet_selections.bet_markets.week_id', weekId)
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
  // customLineId tags the bet with a special's identity (title/description/
  // category snapshotted server-side, so branding survives line edits/deletion).
  // insuranceItemId attaches a Golden Ticket (consumed at placement, win or
  // lose; if the bet loses the stake refunds at settlement). crutchItemId
  // attaches a Winner's Crutch (parlays only; cancels the lone losing leg and
  // pays the survivors at reduced odds). boostItemId attaches an Energy Drink
  // (any bet; on a win the House pays a bonus = profit × boost_pct, doubling the
  // profit 1:1 → 2:1). All three are spent at placement and stack.
  place: (selectionIds: string[], stake: number, customLineId?: string, insuranceItemId?: string, crutchItemId?: string, boostItemId?: string) =>
    // undefined is dropped from the RPC payload → the param's NULL default applies.
    supabase.rpc('place_house_bet', { p_selection_ids: selectionIds, p_stake: stake, p_custom_line_id: customLineId, p_insurance_item_id: insuranceItemId, p_crutch_item_id: crutchItemId, p_boost_item_id: boostItemId }),
  // Admin: total undo of a placed bet (removes ledger rows + bet, re-opens market).
  cancel: (betId: string) =>
    supabase.rpc('cancel_bet', { p_bet_id: betId }),
}

// ── Ghost in the Slip (bet_haunts) ──────────────────────────────────────────
// The adversarial item: a player secretly attaches a Ghost to ANOTHER player's
// pending bet. If it wins, the ghosts split the profit and the bettor keeps only
// their stake (settled in finalize_bets_for_market). RLS keeps a pending haunt
// visible only to its haunter; it goes public once the target bet has WON.
export const haunts = {
  // The viewer's own haunts (RLS returns only the caller's rows) — used to mark
  // bets they've already haunted so the CTA disables. Returns bet_ids.
  listMine: (playerId: string) =>
    supabase.from('bet_haunts').select('bet_id').eq('haunter_player_id', playerId),
  // Haunters on one bet, oldest first. RLS reveals foreign rows ONLY once the bet
  // has won (or to the haunter themselves) — drives the Bet Details reveal.
  listForBet: (betId: string) =>
    supabase.from('bet_haunts')
      .select('payout_amount, attached_at, players(name)')
      .eq('bet_id', betId)
      .order('attached_at', { ascending: true }),
  // Secretly haunt a foreign pending bet (SECURITY DEFINER; consumes the item).
  create: (targetBetId: string, itemId: string) =>
    supabase.rpc('haunt_bet', { p_target_bet_id: targetBetId, p_item_id: itemId }),
}

// ── Custom lines ("Specials") ────────────────────────────────────────────────
// Admin-authored templates bundling existing bet_selections under a custom
// title. Legs are abstract specs ({kind, player_id, game_number, pick}) resolved
// client-side against the week's markets in usePinsinoData; taking one places an
// ordinary single/parlay via bets.place — no bespoke settlement path. week_ids
// null = permanent (offered every week while is_active). Admin writes are direct
// table ops through RLS (no money moves at create/edit time).
export const customLines = {
  // Place Bets board: active lines only; week applicability (week_ids null or
  // containing the current week) is filtered client-side in usePinsinoData.
  listActive: () =>
    supabase.from('custom_lines').select('*').eq('is_active', true).order('created_at', { ascending: false }),
  // Admin Specials view: everything, including disabled lines.
  listAll: () =>
    supabase.from('custom_lines').select('*').order('created_at', { ascending: false }),
  create: (data: TablesInsert<'custom_lines'>) =>
    supabase.from('custom_lines').insert(data),
  // Edits replace legs jsonb wholesale; bets already placed are unaffected —
  // they hold concrete selection ids snapshotted at placement.
  update: (id: string, data: TablesUpdate<'custom_lines'>) =>
    supabase.from('custom_lines').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('custom_lines').delete().eq('id', id),
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
  // Whether a player has already earned the RSVP self-submit bonus for a week —
  // backs the deadline banner's hide-once-claimed. Reads are RLS-open.
  rsvpBonusForWeek: (weekId: string, playerId: string) =>
    supabase
      .from('pin_ledger')
      .select('id')
      .eq('week_id', weekId)
      .eq('player_id', playerId)
      .eq('type', 'rsvp_bonus')
      .limit(1)
      .maybeSingle(),
}

// Admin-issued, house-funded `bonus` pins (e.g. a "Reigning Champion" bonus).
// The RPC is admin-only, resolves the current season server-side, writes the
// double-entry pair per recipient, and publishes a Market Moves event each.
export const bonuses = {
  issue: (playerIds: string[], amount: number, label: string) =>
    supabase.rpc('issue_pin_bonus', {
      p_player_ids: playerIds,
      p_amount: amount,
      p_label: label,
    }),
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

  // Challenges Won board: every settled contract leaguewide for the season,
  // newest result first. `status='settled'` implies a winner (pushed/voided
  // carry a null winner_player_id), so these are wins by definition. Both party
  // names are embedded so the public board can name winner and loser.
  listWonBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES)
      .eq('season_id', seasonId)
      .eq('status', 'settled')
      .order('settled_at', { ascending: false }),

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

// ── Auction House (auctions / auction_bids) + item framework ─────────────────
// Sealed-bid pledge auctions (context/economy/AUCTION_FINDINGS.md). All writes
// go through SECURITY DEFINER RPCs — the tables carry NO write policies.
// auction_bids rows are owner-only with the amount encrypted at rest, so the
// existence of YOUR bid comes from a plain select (RLS filters to yours) but
// the amount is readable only via the my_bid_amount RPC.
const AUCTION_GRAPH =
  '*, item_catalog(key, name, description, icon, effect_type, activation_mode), ' +
  'winner:players!auctions_winner_player_id_fkey(name)'

export interface AuctionRpcInput {
  catalogKey: string
  description: string
  minimumBid: number
  opensAt: string
  closesAt: string
  // Units on the block (1–50): the top N sealed bidders each win one,
  // pay-as-bid.
  quantity: number
}

export const auctions = {
  // Auction House list: every auction of the season (open/scheduled/settled
  // sectioning is pure compute in utils/auction.ts).
  listBySeason: (seasonId: string) =>
    supabase.from('auctions').select(AUCTION_GRAPH)
      .eq('season_id', seasonId)
      .order('closes_at', { ascending: false }),
  getById: (auctionId: string) =>
    supabase.from('auctions').select(AUCTION_GRAPH).eq('id', auctionId).single(),
  // The viewer's own active bid rows (RLS: owner-only — other players' bids
  // never arrive). Amounts are ciphertext; use myBidAmount for the number.
  listMyBids: () =>
    supabase.from('auction_bids').select('id, auction_id, status').eq('status', 'active'),
  myBidAmount: (auctionId: string) =>
    supabase.rpc('my_bid_amount', { p_auction_id: auctionId }),
  // Bids are commitments: placeBid also edits (>= minimum_bid). There is no
  // cancel — the RPC was dropped (no-cancel decision, AUCTION_FINDINGS).
  placeBid: (auctionId: string, amount: number) =>
    supabase.rpc('place_auction_bid', { p_auction_id: auctionId, p_amount: amount }),
  create: (a: AuctionRpcInput) =>
    supabase.rpc('create_auction', {
      p_catalog_key: a.catalogKey,
      p_description: a.description,
      p_minimum_bid: a.minimumBid,
      p_opens_at: a.opensAt,
      p_closes_at: a.closesAt,
      p_quantity: a.quantity,
    }),
  update: (auctionId: string, a: AuctionRpcInput) =>
    supabase.rpc('update_auction', {
      p_auction_id: auctionId,
      p_catalog_key: a.catalogKey,
      p_description: a.description,
      p_minimum_bid: a.minimumBid,
      p_opens_at: a.opensAt,
      p_closes_at: a.closesAt,
      p_quantity: a.quantity,
    }),
  openNow: (auctionId: string) =>
    supabase.rpc('open_auction_now', { p_auction_id: auctionId }),
  // Admin "Settle Now" = closing the auction: stamps closes_at and runs the
  // one settlement path (the same one the cron sweep calls).
  settle: (auctionId: string) =>
    supabase.rpc('settle_auction', { p_auction_id: auctionId }),
  cancel: (auctionId: string) =>
    supabase.rpc('cancel_auction', { p_auction_id: auctionId }),
  reverse: (auctionId: string) =>
    supabase.rpc('reverse_settled_auction', { p_auction_id: auctionId }),
}

// Auction House open/closed kill-switch (auction_house_state, one row per
// season). Read by everyone (drives the Pinsino tile overlay + entry gate);
// only admins can flip it, through the guarded RPC. Absent row = open.
export const auctionHouseState = {
  getBySeason: (seasonId: string) =>
    supabase.from('auction_house_state')
      .select('is_closed, closed_message')
      .eq('season_id', seasonId)
      .maybeSingle(),
  setClosed: (isClosed: boolean, closedMessage: string | null) =>
    supabase.rpc('set_auction_house_closed', {
      p_is_closed: isClosed,
      // The RPC param defaults to NULL; omit it (undefined) to clear the message
      // server-side rather than send an explicit null.
      p_closed_message: closedMessage ?? undefined,
    }),
}

// Auction money is plain pin_ledger rows tagged with auction_id. The player
// side of 'auction_check_bounce' rows is the public bounce story (name + fee
// — the pledged amount was destroyed at settlement and exists nowhere).
export const auctionLedger = {
  listBySeason: (seasonId: string) =>
    supabase.from('pin_ledger').select('auction_id, amount, type, is_house, players(name)')
      .eq('season_id', seasonId)
      .not('auction_id', 'is', null)
      .eq('is_house', false),
}

export interface CatalogItemRpcInput {
  name: string
  description: string
  icon: string
  effectType: string
  effectParams: Json
  activationMode: string
}

export const itemCatalog = {
  // Create-modal picker + item display copy. Catalog rows are admin-curated;
  // functional columns are frozen once instances exist (the update RPC enforces).
  listActive: () =>
    supabase.from('item_catalog').select('*').eq('is_active', true).order('created_at'),
  // Admin catalog list: every row (incl. retired) + instance count — count > 0
  // means the functional columns are frozen (the UI mirrors the DB guard).
  listAllWithCounts: () =>
    supabase.from('item_catalog').select('*, player_inventory_items(count)').order('created_at'),
  create: (key: string, c: CatalogItemRpcInput) =>
    supabase.rpc('create_catalog_item', {
      p_key: key,
      p_name: c.name,
      p_description: c.description,
      p_icon: c.icon,
      p_effect_type: c.effectType,
      p_effect_params: c.effectParams,
      p_activation_mode: c.activationMode,
    }),
  update: (catalogItemId: string, c: CatalogItemRpcInput, isActive: boolean) =>
    supabase.rpc('update_catalog_item', {
      p_catalog_item_id: catalogItemId,
      p_name: c.name,
      p_description: c.description,
      p_icon: c.icon,
      p_effect_type: c.effectType,
      p_effect_params: c.effectParams,
      p_activation_mode: c.activationMode,
      p_is_active: isActive,
    }),
}

export const inventoryItems = {
  // My Items: every atomic single-use row (active + spent) for the season;
  // grouping/sorting is pure compute (utils/auction.ts groupInventory).
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('player_inventory_items')
      .select('*, item_catalog(key, name, description, icon, effect_type, effect_params, activation_mode)')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('granted_at', { ascending: false }),
  grant: (playerId: string, catalogKey: string, quantity = 1) =>
    supabase.rpc('grant_inventory_item', {
      p_player_id: playerId, p_catalog_key: catalogKey, p_quantity: quantity,
    }),
  // Admin: every inventory row for the season across all players (RLS "owner or
  // admin can read inventory" lets admins see everyone). Powers the admin
  // remove-item view; player names join for grouping.
  listAllForSeason: (seasonId: string) =>
    supabase.from('player_inventory_items')
      .select('*, item_catalog(key, name, icon, effect_type), players!player_inventory_items_player_id_fkey(id, name)')
      .eq('season_id', seasonId)
      .order('granted_at', { ascending: false }),
  // Admin: hard-delete a single unconsumed inventory row (undo a bad grant).
  // The RPC refuses consumed/attached items; cascade-safe by construction.
  revoke: (itemId: string) =>
    supabase.rpc('revoke_inventory_item', { p_item_id: itemId }),
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
  // Archived weeks + their settle state (settled_at NULL = advanced-but-unsettled)
  // and enough metadata to synthesize an import-screen row for a week that has no
  // LaneTalk imports yet. Powers the "Settle Week" gate + injection.
  listArchivedSettleState: () =>
    supabase
      .from('weeks')
      .select('id, week_number, bowled_at, settled_at, season_id, seasons(number)')
      .eq('is_archived', true),
  listBySeason: (seasonId: string) =>
    supabase
      .from('weeks')
      .select('*')
      .eq('season_id', seasonId)
      .order('week_number'),
  // The current playing week: latest unarchived week of the CURRENT season
  // (season-scoped — an unscoped query would leak another season's weeks).
  // maybeSingle: during the soft-unarchive window no unarchived week exists,
  // which is a legitimate null, not an error.
  getCurrent: () =>
    supabase
      .from('weeks')
      .select('*, seasons!inner(is_active, registration_open)')
      .eq('seasons.is_active', true)
      .eq('seasons.registration_open', false)
      .eq('is_archived', false)
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  // The week "in play" for display (AppHeader): latest week of the current
  // season regardless of archive state, so the label stays truthful during the
  // soft-unarchive window (week N locked, week N+1 destroyed).
  getLatestOfCurrentSeason: () =>
    supabase
      .from('weeks')
      .select('*, seasons!inner(is_active, registration_open)')
      .eq('seasons.is_active', true)
      .eq('seasons.registration_open', false)
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  getActive: () =>
    supabase
      .from('weeks')
      .select('*, seasons!inner(is_active, registration_open)')
      .eq('seasons.is_active', true)
      .eq('seasons.registration_open', false)
      .eq('is_archived', false)
      .eq('is_confirmed', true)
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  getById: (id: string) =>
    supabase.from('weeks').select('*').eq('id', id).single(),
  insert: (data: TablesInsert<'weeks'>) =>
    supabase.from('weeks').insert(data),
  update: (id: string, data: TablesUpdate<'weeks'>) =>
    supabase.from('weeks').update(data).eq('id', id),
}

// Admin-only Archives: atomic weekly archive + reversible unarchive.
// archive_week replaces the old multi-step client archive (lock → settle → next
// week) with one transaction that also snapshots everything settlement touches.
// unarchive_week restores the economy to the archive-time checkpoint, always
// destroys week N+1, and (mode 'hard') unlocks the score lock. See ARCHIVE.md.
export const archives = {
  // Bowl-night clock: lock the week, snapshot the fill scores, create N+1. NO
  // money — settlement is the next-day settleWeek step. fillScores: the unscored
  // fill participation rows valued at the on-screen league-average estimate
  // ([{team_slot_id, game_id, score}]) — advance_week stamps them (snapshot-
  // reversed by unarchive) so archived records match the live matchup totals.
  advanceWeek: (weekId: string, force = false, fillScores: { team_slot_id: string; game_id: string; score: number }[] = []) =>
    supabase.rpc('advance_week', { p_week_id: weekId, p_force: force, p_fill_scores: fillScores }),
  // Next-day clock: settle ALL money for an advanced (locked) week — pincome,
  // bets, LaneTalk props, loans, PvP, unified House P/L. voidMissing delete-
  // refunds prop markets still lacking data; force voids any non-LaneTalk bet
  // that would otherwise remain pending. Additive + idempotent: safe to re-run
  // after a late import. Returns { settled, voided, left_pending, house_net }.
  settleWeek: (weekId: string, voidMissing = false, force = false) =>
    supabase.rpc('settle_week', { p_week_id: weekId, p_void_missing: voidMissing, p_force: force }),
  // Read-only dry run: classify every non-settled market settleable vs would_void
  // (with reason). Powers the pre-settle warning. Mutates nothing.
  previewSettleWeek: (weekId: string) =>
    supabase.rpc('preview_settle_week', { p_week_id: weekId }),
  // Reverse a week's settlement money only, keeping it advanced (locked) — the
  // "settlement was wrong / re-derive from newer imports" path. A following
  // settleWeek re-derives. Does NOT reopen the week or touch scores.
  unsettleWeek: (weekId: string) =>
    supabase.rpc('unsettle_week', { p_week_id: weekId }),
  // DEPRECATED shim (kept until callers migrate): advance_week + settle_week in
  // one atomic call, preserving the old one-tap archive semantics.
  archiveWeek: (weekId: string, force = false, fillScores: { team_slot_id: string; game_id: string; score: number }[] = []) =>
    supabase.rpc('archive_week', { p_week_id: weekId, p_force: force, p_fill_scores: fillScores }),
  // Reverses the week's settlement, destroys week N+1, and reopens the week
  // (is_archived → false) so it is simply in play again; re-archive via
  // MatchupsScreen's Archive & Advance. force: override the week-N+1
  // downstream-activity guard.
  unarchiveWeek: (weekId: string, force = false) =>
    supabase.rpc('unarchive_week', { p_week_id: weekId, p_force: force }),
  listArchivedWeeks: (seasonId: string) =>
    supabase
      .from('weeks')
      .select('*')
      .eq('season_id', seasonId)
      .eq('is_archived', true)
      .order('week_number', { ascending: false }),
}

// ── Playoff draft ───────────────────────────────────────────────────────────
// Captains draft playoff teams from the season's registered+active players.
// Whose-turn is DERIVED from the pick log (snake/straight over seeds) — the
// SQL function playoff_current_turn and computeDraftTurn (usePlayoffDraftData)
// implement the same math. Captain picks go through the turn-enforced
// playoff_make_pick RPC; admin fixes use direct table access under RLS, except
// the status-coupled mutations (undo, materialize) which have RPCs.
export const playoffDrafts = {
  // The season's draft with its full graph: captains (+names, seed-ordered),
  // pool (+names), picks (+names, pick-ordered) in one round-trip.
  getBySeasonWithGraph: (seasonId: string) =>
    supabase
      .from('playoff_drafts')
      .select(
        '*,' +
        'playoff_draft_captains(*, players(id, name)),' +
        'playoff_draft_pool(*, players(id, name)),' +
        'playoff_draft_picks(*, picked:players!playoff_draft_picks_picked_player_id_fkey(id, name))'
      )
      .eq('season_id', seasonId)
      .maybeSingle(),
  // Admin setup. Captain ids are seed-ordered (the screen orders them by
  // current standings first); the RPC seeds the pool from registered+active
  // players and flags the week is_playoff.
  create: (seasonId: string, weekId: string, draftType: 'snake' | 'straight', captainPlayerIds: string[]) =>
    supabase.rpc('playoff_create_draft', {
      p_season_id: seasonId,
      p_week_id: weekId,
      p_draft_type: draftType,
      p_captain_player_ids: captainPlayerIds,
    }),
  // Admin: status flips (setup→drafting) and draft_type edits.
  update: (id: string, data: TablesUpdate<'playoff_drafts'>) =>
    supabase.from('playoff_drafts').update(data).eq('id', id),
  // Admin reset, valid in every status: deletes the draft (cascades captains/
  // pool/picks), un-flags the week, and — when materialized — also tears down
  // the week's teams and unconfirms it. Refuses on an archived playoff week.
  reset: (id: string) =>
    supabase.rpc('playoff_reset_draft', { p_draft_id: id }),
  // Captain (or admin on the clock-holder's behalf): record the next pick.
  makePick: (draftId: string, playerId: string) =>
    supabase.rpc('playoff_make_pick', { p_draft_id: draftId, p_player_id: playerId }),
  // Admin: delete the latest pick (turn rewinds; completed → drafting).
  undoPick: (draftId: string) =>
    supabase.rpc('playoff_undo_pick', { p_draft_id: draftId }),
  // Admin: write the drafted rosters as teams/team_slots on the playoff week.
  materializeTeams: (draftId: string) =>
    supabase.rpc('playoff_materialize_teams', { p_draft_id: draftId }),
  // Admin pool pruning while in setup.
  removeFromPool: (poolRowId: string) =>
    supabase.from('playoff_draft_pool').delete().eq('id', poolRowId),
  addToPool: (draftId: string, playerId: string) =>
    supabase.from('playoff_draft_pool').insert({ draft_id: draftId, player_id: playerId }),
  // Lightweight captain check (MoreHome tile gating): the captain player ids
  // of a season's draft, if one exists.
  listCaptainIdsForSeason: (seasonId: string) =>
    supabase
      .from('playoff_draft_captains')
      .select('player_id, playoff_drafts!inner(season_id)')
      .eq('playoff_drafts.season_id', seasonId),
  // Setup: candidates for captaincy / the pool — the season's registered,
  // active players (same population the create RPC seeds the pool from).
  listDraftablePlayers: (seasonId: string) =>
    supabase
      .from('registrations')
      .select('player_id, players!inner(id, name, is_active)')
      .eq('season_id', seasonId)
      .eq('players.is_active', true),
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
  /** Reprocess mode: true when this summary came from re-deriving a stored week. */
  reprocessed?: boolean
  /** Reprocess mode: matched players / rows recomputed. */
  players?: number
  rowCount?: number
  /** Failure stage tag from the Edge Function (e.g. 'fetch_status', 'auth_not_admin'). */
  stage?: string
  /** Per-request id — present on every response; grep the function logs by it. */
  reqId?: string
  /** Stage-specific diagnostics (status, bodySnippet, parsed player/date, etc.). */
  debug?: Record<string, unknown>
}

// Invoke the lanetalk-import Edge Function and normalize its response. The
// function returns recoverable failures as 200 { ok:false, … } but auth (403)
// and server (500) failures as non-2xx — for those, supabase-js puts a generic
// FunctionsHttpError in `error` and the real JSON body (with stage / message /
// debug) on error.context. Normalize both so the caller always sees the
// function's actual message and diagnostics.
async function invokeLanetalk(body: Record<string, unknown>): Promise<LanetalkImportSummary> {
  const { data, error } = await supabase.functions.invoke<LanetalkImportSummary>('lanetalk-import', { body })
  if (error) {
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        const parsed = await ctx.json()
        if (parsed && typeof parsed === 'object') return parsed as LanetalkImportSummary
      } catch { /* body wasn't JSON — fall through to the generic message */ }
    }
    return { ok: false, stage: 'invoke', message: error.message ?? 'Request failed' }
  }
  return data ?? { ok: false, stage: 'invoke', message: 'Empty response' }
}

export const lanetalkImports = {
  // Fetch, parse, match and write a single link's games. An optional weekId
  // pins the import to an explicit week (skips date-based resolution) — the
  // safety valve for an unparseable date or a lane-split night.
  run: (url: string, weekId?: string): Promise<LanetalkImportSummary> =>
    invokeLanetalk(weekId ? { url, weekId } : { url }),
  // Re-derive an already-imported week from its stored payloads (no link fetch):
  // re-matches games to official scores and renumbers across links. The fix for
  // a lane-split night the admin can't clear and re-import cleanly.
  reprocessWeek: (weekId: string): Promise<LanetalkImportSummary> => invokeLanetalk({ reprocessWeekId: weekId }),
  listRecent: () =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name), weeks(week_number, bowled_at, season_id, seasons(number))')
      .order('created_at', { ascending: false })
      .limit(200),
  listBySourceUrl: (url: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name)')
      .eq('source_url', url)
      .order('game_number'),
  // Every imported game for one player, oldest first — frame-level game details.
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
  // One week's official imports — the Confirm modal's data-coverage preview
  // (informational; the settlement RPC recomputes authoritatively server-side).
  listOfficialByWeek: (weekId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('player_id, game_number, payload')
      .eq('week_id', weekId)
      .eq('classification', 'official'),
  // Every official import on an archived week, with its frame payload — the
  // frame-data League Records (strikes / spares / frames closed, game + night).
  listForLeagueRecords: () =>
    supabase
      .from('lanetalk_game_imports')
      .select(
        'player_id, week_id, game_number, score, payload,' +
        'players(name),' +
        'weeks!inner(week_number, season_id, is_archived, seasons!inner(number))'
      )
      .eq('classification', 'official')
      .eq('weeks.is_archived', true)
      .not('player_id', 'is', null),
  // Admin re-classification of a single imported game (Official ⇄ Recreational).
  setClassification: (id: string, classification: 'official' | 'recreational') =>
    supabase
      .from('lanetalk_game_imports')
      .update({ classification })
      .eq('id', id),
}

// ── Push Broadcasts ──────────────────────────────────────────────────────────
// "Broadcast" = an admin-composed push notification (see context/push-broadcasts.md).
// Tokens are secrets: they only ever move through the two SECURITY DEFINER RPCs;
// there is no client read path at all.

export const push = {
  registerToken: (token: string, platform: 'ios' | 'android') =>
    supabase.rpc('register_push_token', { p_token: token, p_platform: platform }),
  unregisterToken: (token: string) =>
    supabase.rpc('unregister_push_token', { p_token: token }),
  listCategories: () =>
    supabase
      .from('broadcast_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order'),
  // Both pref reads return only the caller's rows via RLS. An ABSENT row means
  // enabled — the hooks default missing entries to ON.
  getPrefs: (playerId: string) =>
    supabase.from('push_preferences').select('*').eq('player_id', playerId).maybeSingle(),
  listCategoryPrefs: (playerId: string) =>
    supabase.from('push_category_prefs').select('*').eq('player_id', playerId),
  setMaster: (playerId: string, enabled: boolean) =>
    supabase
      .from('push_preferences')
      .upsert({ player_id: playerId, master_enabled: enabled }, { onConflict: 'player_id' }),
  setCategoryPref: (playerId: string, categoryId: string, enabled: boolean) =>
    supabase
      .from('push_category_prefs')
      .upsert(
        { player_id: playerId, category_id: categoryId, enabled },
        { onConflict: 'player_id,category_id' },
      ),
}

/** Shape returned by the send-broadcasts Edge Function. */
export interface BroadcastSendSummary {
  ok: boolean
  broadcastId?: string
  skipped?: boolean
  recipients?: number
  delivered?: number
  failed?: number
  failedWith?: string
  message?: string
  stage?: string
  reqId?: string
}

export const broadcasts = {
  listRecent: () =>
    supabase
      .from('broadcasts')
      .select('*, broadcast_categories(key, label), players!broadcasts_created_by_fkey(name)')
      .order('created_at', { ascending: false })
      .limit(50),
  create: (data: TablesInsert<'broadcasts'>) =>
    supabase.from('broadcasts').insert(data).select('id').single(),
  cancel: (id: string) => supabase.rpc('broadcast_cancel', { p_id: id }),
  // Counts only — tokens never leave the DB (admin-gated in SQL).
  reach: (categoryId: string, targetPlayerIds: string[] | null) =>
    supabase.rpc('broadcast_reach', {
      p_category_id: categoryId,
      p_target_player_ids: targetPlayerIds ?? undefined,
    }),
  // Send-now: fire the Edge Function directly so the admin isn't waiting on
  // the next cron tick. If the invoke fails the sweep still picks the row up.
  sendNow: async (broadcastId: string): Promise<BroadcastSendSummary> => {
    const { data, error } = await supabase.functions.invoke<BroadcastSendSummary>(
      'send-broadcasts',
      { body: { broadcastId } },
    )
    if (error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        try {
          const parsed = await ctx.json()
          if (parsed && typeof parsed === 'object') return parsed as BroadcastSendSummary
        } catch { /* body wasn't JSON — fall through */ }
      }
      return { ok: false, stage: 'invoke', message: error.message ?? 'Request failed' }
    }
    return data ?? { ok: false, stage: 'invoke', message: 'Empty response' }
  },
}

// Automated Market Moves pushes — one optional rule per activity_event_catalog
// event type (context/push-broadcasts.md). The catalog LEFT JOIN is the
// future-proofing contract: new event types appear here rule-less (= off)
// with zero code changes.
export const broadcastEventRules = {
  // To-one embed: broadcast_event_rules.event_type is both its PK and the FK,
  // so PostgREST returns an object-or-null per catalog row.
  listCatalog: () =>
    supabase
      .from('activity_event_catalog')
      .select(
        'event_type, source_feature, broadcast_event_rules(enabled, category_id, title_template, body_template, route_key)',
      )
      .order('source_feature')
      .order('event_type'),
  upsert: (rule: TablesInsert<'broadcast_event_rules'>) =>
    supabase.from('broadcast_event_rules').upsert(rule, { onConflict: 'event_type' }),
  setEnabled: (eventType: string, enabled: boolean) =>
    supabase.from('broadcast_event_rules').update({ enabled }).eq('event_type', eventType),
}
