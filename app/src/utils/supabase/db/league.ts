import { supabase } from '../client'
import type { TablesInsert, TablesUpdate } from '../database.types'

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
  // Admin remediation: pay the missed self-submit bonus for a player who has
  // an rsvp row but no rsvp_bonus credit (e.g. their outdated build saved via
  // the plain upsert). SECURITY DEFINER + admin-guarded; same dedup key as
  // submit_own_rsvp so it can never double-pay. Skips the deadline/is_enabled
  // checks on purpose. Returns { awarded, amount, reason }.
  adminGrantBonus: (playerId: string, weekId: string) =>
    supabase.rpc('admin_grant_rsvp_bonus', { p_player_id: playerId, p_week_id: weekId }),
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
