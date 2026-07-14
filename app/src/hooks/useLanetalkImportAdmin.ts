import { lanetalkImports, betMarkets, seasons, weeks } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

interface LanetalkImportPayload {
  rawImports: any[]
  unsettledProps: any[]
  // Weeks with settled LaneTalk props — lets the screen badge a week as
  // Confirmed (vs Unconfirmed when it still appears in unsettledProps).
  settledPropWeeks: Set<string>
  // Archived weeks → their settled_at (null = advanced-but-unsettled). Gates the
  // per-week "Settle Week" action: settle_week only runs on an advanced week,
  // and re-settle picks up late imports.
  archivedSettleState: Map<string, string | null>
  // The archived week rows themselves (id, week_number, bowled_at, settled_at,
  // season_id, season number) — lets the screen inject a Settle row for an
  // advanced week that has no LaneTalk imports yet.
  archivedWeeks: any[]
  // The current season's id — the Recent Imports list groups by season and
  // starts every season collapsed except this one.
  currentSeasonId: string | null
}

const EMPTY: LanetalkImportPayload = {
  rawImports: [],
  unsettledProps: [],
  settledPropWeeks: new Set(),
  archivedSettleState: new Map(),
  archivedWeeks: [],
  currentSeasonId: null,
}

/** Recent Lanetalk import rows (one per game) for the admin import screen, plus
 *  the unsettled LaneTalk stat-prop markets (any week) — these ride a separate
 *  settlement clock from archive, so the screen surfaces a per-week
 *  "Confirm LaneTalk Data" action wherever any are still pending. */
export function useLanetalkImportAdmin() {
  const { loading, data, reload } = useAsyncData<LanetalkImportPayload>(async () => {
    const [importsRes, propsRes, settledRes, archivedRes, currentSeasonRes] = await Promise.all([
      lanetalkImports.listRecent(),
      betMarkets.listUnsettledLanetalkProps(),
      betMarkets.listSettledLanetalkPropWeeks(),
      weeks.listArchivedSettleState(),
      seasons.getCurrent(),
    ])
    return {
      rawImports: importsRes.data ?? [],
      unsettledProps: propsRes.data ?? [],
      settledPropWeeks: new Set((settledRes.data ?? []).map(r => r.week_id).filter((id): id is string => !!id)),
      archivedSettleState: new Map((archivedRes.data ?? []).map(r => [r.id as string, (r.settled_at ?? null) as string | null])),
      archivedWeeks: archivedRes.data ?? [],
      currentSeasonId: currentSeasonRes.data?.id ?? null,
    }
  }, [], 'useLanetalkImportAdmin')

  return { loading, ...(data ?? EMPTY), reload }
}
