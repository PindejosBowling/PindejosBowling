import { supabase } from '../client'
import type { TablesUpdate } from '../database.types'

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
