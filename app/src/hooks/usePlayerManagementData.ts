import { Tables } from '../utils/supabase/database.types'
import { players } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

interface PlayerManagementPayload {
  rawPlayers: Tables<'players'>[]
}

const EMPTY: PlayerManagementPayload = { rawPlayers: [] }

export function usePlayerManagementData() {
  const { loading, data, reload } = useAsyncData<PlayerManagementPayload>(async () => {
    const { data } = await players.list()
    return { rawPlayers: data ?? [] }
  }, [], 'usePlayerManagementData')

  return { loading, ...(data ?? EMPTY), reload }
}
