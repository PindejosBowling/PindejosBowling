import { registrations, seasons, players } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

export interface RegistrationRow {
  id: string
  season_id: string
  player_id: string
  payment_received: boolean
  created_at: string
  players: { id: string; name: string | null } | null
}

export interface SeasonOption {
  id: string
  number: number
  registration_open: boolean
  is_active: boolean
  bowling_night: string
  start_date: string
  end_date: string | null
}

export interface RosterPlayer {
  id: string
  name: string | null
}

interface RegistrationPayload {
  rawRegistrations: RegistrationRow[]
  seasonList: SeasonOption[]
  allPlayers: RosterPlayer[]
}

const EMPTY: RegistrationPayload = { rawRegistrations: [], seasonList: [], allPlayers: [] }

export function useRegistrationData() {
  const { loading, data, reload } = useAsyncData<RegistrationPayload>(async () => {
    const [regRes, seasonsRes, playersRes] = await Promise.all([
      registrations.list(),
      seasons.list(),
      players.list(),
    ])
    return {
      rawRegistrations: (regRes.data ?? []) as RegistrationRow[],
      seasonList: (seasonsRes.data ?? []).map(s => ({
        id: s.id,
        number: s.number,
        registration_open: s.registration_open,
        is_active: s.is_active,
        bowling_night: s.bowling_night,
        start_date: s.start_date,
        end_date: s.end_date,
      })),
      allPlayers: (playersRes.data ?? []).map(p => ({ id: p.id, name: p.name })),
    }
  }, [], 'useRegistrationData')

  return { loading, ...(data ?? EMPTY), reload }
}
