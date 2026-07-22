import { useEffect, useState } from 'react'
import { betMarkets } from '../utils/supabase/db'

// One rung of a combo's priced ladder (combo_preview_ladder).
export interface ComboLadderRung {
  line: number
  odds: number
  isSeed: boolean
}

// Live combo ladder preview — the priced rungs the market will carry
// (combo_preview_ladder shares its math with compose_combo_bet, and returns
// the POSTED rungs verbatim when the combo already has an open market).
// Display + rung choice only: the compose RPC re-validates the chosen line.
// Debounced 250ms per member/stat/scope change. Inactive (ladder null) until
// 2+ members and a stat/season are set.
export function useComboLinePreview(
  memberIds: string[],
  stat: string | null,
  seasonId: string | null,
  nGames: number,
  weekId: string | null,
  gameNumber: number | null,
): { ladder: ComboLadderRung[] | null; seedIndex: number; loading: boolean } {
  const [ladder, setLadder] = useState<ComboLadderRung[] | null>(null)
  const [loading, setLoading] = useState(false)
  const memberKey = memberIds.join(',')

  useEffect(() => {
    if (memberIds.length < 2 || !stat || !seasonId) {
      setLadder(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await betMarkets.previewComboLadder(
        memberIds, stat, seasonId, nGames, weekId, gameNumber
      )
      if (!cancelled) {
        const rows = Array.isArray(data) ? (data as any[]) : []
        setLadder(
          rows.length > 0
            ? rows.map(r => ({
                line: Number(r.line),
                odds: Number(r.odds),
                isSeed: !!r.is_seed,
              }))
            : null
        )
        setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [memberKey, stat, seasonId, nGames, weekId, gameNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  const seedIndex = ladder ? Math.max(0, ladder.findIndex(r => r.isSeed)) : 0
  return { ladder, seedIndex, loading }
}
