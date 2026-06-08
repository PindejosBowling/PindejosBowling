import { useState, useCallback, useEffect } from 'react'
import { registrations, seasons, players } from '../utils/supabase/db'

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

export function useRegistrationData() {
  const [loading, setLoading] = useState(true)
  const [rawRegistrations, setRawRegistrations] = useState<RegistrationRow[]>([])
  const [seasonList, setSeasonList] = useState<SeasonOption[]>([])
  const [allPlayers, setAllPlayers] = useState<RosterPlayer[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [regRes, seasonsRes, playersRes] = await Promise.all([
        registrations.list(),
        seasons.list(),
        players.list(),
      ])
      setRawRegistrations((regRes.data ?? []) as RegistrationRow[])
      setSeasonList(
        (seasonsRes.data ?? []).map(s => ({
          id: s.id,
          number: s.number,
          registration_open: s.registration_open,
          is_active: s.is_active,
          bowling_night: s.bowling_night,
          start_date: s.start_date,
          end_date: s.end_date,
        })),
      )
      setAllPlayers((playersRes.data ?? []).map(p => ({ id: p.id, name: p.name })))
    } catch (e) {
      console.error('useRegistrationData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawRegistrations, seasonList, allPlayers, reload: load }
}
