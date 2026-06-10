import { useState, useCallback, useEffect } from 'react'
import { lanetalkImports } from '../utils/supabase/db'

/** Recent Lanetalk import rows (one per game) for the admin import screen. */
export function useLanetalkImportAdmin() {
  const [loading, setLoading] = useState(true)
  const [rawImports, setRawImports] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await lanetalkImports.listRecent()
      setRawImports(data ?? [])
    } catch (e) {
      console.error('useLanetalkImportAdmin error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawImports, reload: load }
}
