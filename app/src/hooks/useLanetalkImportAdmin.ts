import { lanetalkImports, betMarkets } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

interface LanetalkImportPayload {
  rawImports: any[]
  unsettledProps: any[]
  // Weeks with settled LaneTalk props — lets the screen badge a week as
  // Confirmed (vs Unconfirmed when it still appears in unsettledProps).
  settledPropWeeks: Set<string>
}

const EMPTY: LanetalkImportPayload = {
  rawImports: [],
  unsettledProps: [],
  settledPropWeeks: new Set(),
}

/** Recent Lanetalk import rows (one per game) for the admin import screen, plus
 *  the unsettled LaneTalk stat-prop markets (any week) — these ride a separate
 *  settlement clock from archive, so the screen surfaces a per-week
 *  "Confirm LaneTalk Data" action wherever any are still pending. */
export function useLanetalkImportAdmin() {
  const { loading, data, reload } = useAsyncData<LanetalkImportPayload>(async () => {
    const [importsRes, propsRes, settledRes] = await Promise.all([
      lanetalkImports.listRecent(),
      betMarkets.listUnsettledLanetalkProps(),
      betMarkets.listSettledLanetalkPropWeeks(),
    ])
    return {
      rawImports: importsRes.data ?? [],
      unsettledProps: propsRes.data ?? [],
      settledPropWeeks: new Set((settledRes.data ?? []).map(r => r.week_id).filter((id): id is string => !!id)),
    }
  }, [], 'useLanetalkImportAdmin')

  return { loading, ...(data ?? EMPTY), reload }
}
