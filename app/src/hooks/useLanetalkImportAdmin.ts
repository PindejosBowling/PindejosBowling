import { useState, useCallback, useEffect } from 'react'
import { lanetalkImports, betMarkets } from '../utils/supabase/db'

/** Recent Lanetalk import rows (one per game) for the admin import screen, plus
 *  the unsettled LaneTalk stat-prop markets (any week) — these ride a separate
 *  settlement clock from archive, so the screen surfaces a per-week
 *  "Confirm LaneTalk Data" action wherever any are still pending. */
export function useLanetalkImportAdmin() {
  const [loading, setLoading] = useState(true)
  const [rawImports, setRawImports] = useState<any[]>([])
  const [unsettledProps, setUnsettledProps] = useState<any[]>([])
  // Weeks with settled LaneTalk props — lets the screen badge a week as
  // Confirmed (vs Unconfirmed when it still appears in unsettledProps).
  const [settledPropWeeks, setSettledPropWeeks] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [importsRes, propsRes, settledRes] = await Promise.all([
        lanetalkImports.listRecent(),
        betMarkets.listUnsettledLanetalkProps(),
        betMarkets.listSettledLanetalkPropWeeks(),
      ])
      setRawImports(importsRes.data ?? [])
      setUnsettledProps(propsRes.data ?? [])
      setSettledPropWeeks(new Set((settledRes.data ?? []).map(r => r.week_id).filter((id): id is string => !!id)))
    } catch (e) {
      console.error('useLanetalkImportAdmin error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawImports, unsettledProps, settledPropWeeks, reload: load }
}
