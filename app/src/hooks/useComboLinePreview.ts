import { useEffect, useState } from 'react'
import { betMarkets } from '../utils/supabase/db'

// Live combo line preview — the number the market will be seeded with
// (combo_seed_line is the same function the compose RPC uses). Display-only:
// the RPC re-seeds at placement. Debounced 250ms per member/stat/scope change.
// Inactive (line null) until 2+ members and a stat/season are set.
export function useComboLinePreview(
  memberIds: string[],
  stat: string | null,
  seasonId: string | null,
  nGames: number,
): { line: number | null; loading: boolean } {
  const [line, setLine] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const memberKey = memberIds.join(',')

  useEffect(() => {
    if (memberIds.length < 2 || !stat || !seasonId) {
      setLine(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await betMarkets.previewComboLine(memberIds, stat, seasonId, nGames)
      if (!cancelled) {
        setLine(data != null ? Number(data) : null)
        setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [memberKey, stat, seasonId, nGames]) // eslint-disable-line react-hooks/exhaustive-deps

  return { line, loading }
}
