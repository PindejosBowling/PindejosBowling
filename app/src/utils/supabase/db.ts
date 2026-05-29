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

export const gameSchedule = {
  listByWeek: (weekId: string) =>
    supabase
      .from('game_schedule')
      .select('*')
      .eq('week_id', weekId)
      .order('game_number'),
  listForArchivedWeeks: () =>
    supabase
      .from('game_schedule')
      .select('week_id, game_number, team_a, team_b, weeks!inner(is_archived)')
      .eq('weeks.is_archived', true),
  insert: (data: TablesInsert<'game_schedule'> | TablesInsert<'game_schedule'>[]) =>
    supabase.from('game_schedule').insert(data),
  remove: (id: string) =>
    supabase.from('game_schedule').delete().eq('id', id),
  removeByWeek: (weekId: string) =>
    supabase.from('game_schedule').delete().eq('week_id', weekId),
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
  insert: (data: TablesInsert<'players'>) =>
    supabase.from('players').insert(data),
  update: (id: string, data: TablesUpdate<'players'>) =>
    supabase.from('players').update(data).eq('id', id),
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
      .select('*, team_slots!inner(week_id, team_number, slot, player_id)')
      .eq('team_slots.week_id', weekId)
      .order('game_number'),
  listBySeason: (seasonId: number) =>
    supabase
      .from('scores')
      .select('score, team_slots!inner(player_id, is_fill, weeks!inner(season_id, is_archived))')
      .eq('team_slots.weeks.season_id', seasonId)
      .eq('team_slots.weeks.is_archived', true)
      .eq('team_slots.is_fill', false)
      .not('score', 'is', null),
  listAllArchived: () =>
    supabase
      .from('scores')
      .select('score, team_slots!inner(player_id, is_fill, weeks!inner(is_archived))')
      .eq('team_slots.weeks.is_archived', true)
      .eq('team_slots.is_fill', false)
      .not('score', 'is', null),
  listForStandings: () =>
    supabase
      .from('scores')
      .select(
        'game_number, score,' +
        'team_slots!inner(id, player_id, team_number, is_fill, week_id,' +
          'players(id, name),' +
          'weeks!inner(season_id, is_archived)' +
        ')'
      )
      .eq('team_slots.weeks.is_archived', true)
      .not('score', 'is', null),
  listForPlayerDetail: () =>
    supabase
      .from('scores')
      .select(
        'game_number, score,' +
        'team_slots!inner(id, player_id, team_number, slot, is_fill, week_id,' +
          'players(id, name),' +
          'weeks!inner(id, season_id, week_number, is_archived,' +
            'seasons!inner(id, number)' +
          ')' +
        ')'
      )
      .eq('team_slots.weeks.is_archived', true)
      .not('score', 'is', null),
  listForH2H: () =>
    supabase
      .from('scores')
      .select(
        'game_number, score,' +
        'team_slots!inner(player_id, team_number, is_fill, week_id,' +
          'players(name),' +
          'weeks!inner(week_number, is_archived,' +
            'seasons!inner(number)' +
          ')' +
        ')'
      )
      .eq('team_slots.weeks.is_archived', true)
      .not('score', 'is', null),
  insert: (data: TablesInsert<'scores'> | TablesInsert<'scores'>[]) =>
    supabase.from('scores').insert(data),
  upsert: (data: TablesInsert<'scores'> | TablesInsert<'scores'>[]) =>
    supabase.from('scores').upsert(data, { onConflict: 'team_slot_id,game_number' }),
  update: (id: string, data: TablesUpdate<'scores'>) =>
    supabase.from('scores').update(data).eq('id', id),
  removeBySlotIds: (ids: string[]) =>
    supabase.from('scores').delete().in('team_slot_id', ids),
  remove: (teamSlotId: string, gameNumber: number) =>
    supabase.from('scores').delete().eq('team_slot_id', teamSlotId).eq('game_number', gameNumber),
}

export const seasonChampions = {
  list: () =>
    supabase
      .from('season_champions')
      .select('*, players(name), seasons(number, league_name)'),
  listBySeason: (seasonId: number) =>
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
  getById: (id: number) =>
    supabase.from('seasons').select('*').eq('id', id).single(),
  insert: (data: TablesInsert<'seasons'>) =>
    supabase.from('seasons').insert(data),
  update: (id: number, data: TablesUpdate<'seasons'>) =>
    supabase.from('seasons').update(data).eq('id', id),
}

export const teamSlots = {
  listByWeek: (weekId: string) =>
    supabase
      .from('team_slots')
      .select('*, players(name)')
      .eq('week_id', weekId)
      .order('team_number')
      .order('slot'),
  listByPlayer: (playerId: string) =>
    supabase
      .from('team_slots')
      .select(
        'id, team_number, slot, is_fill, week_id,' +
        'weeks!inner(id, season_id, week_number, is_archived,' +
          'seasons!inner(id, number)' +
        ')'
      )
      .eq('player_id', playerId)
      .eq('weeks.is_archived', true),
  insert: (data: TablesInsert<'team_slots'> | TablesInsert<'team_slots'>[]) =>
    supabase.from('team_slots').insert(data),
  update: (id: string, data: TablesUpdate<'team_slots'>) =>
    supabase.from('team_slots').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('team_slots').delete().eq('id', id),
  removeByWeek: (weekId: string) =>
    supabase.from('team_slots').delete().eq('week_id', weekId),
}

export const weeks = {
  list: () =>
    supabase.from('weeks').select('*').order('week_number'),
  listBySeason: (seasonId: number) =>
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
