import { useState, useCallback, useEffect } from 'react'
import { Tables } from '../utils/supabase/database.types'
import { players } from '../utils/supabase/db'

export function usePlayerManagementData() {
  const [loading, setLoading] = useState(true)
  const [rawPlayers, setRawPlayers] = useState<Tables<'players'>[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await players.list()
      setRawPlayers(data ?? [])
    } catch (e) {
      console.error('usePlayerManagementData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawPlayers, reload: load }
}
