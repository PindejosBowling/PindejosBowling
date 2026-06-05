import { useState, useCallback, useEffect } from 'react'
import { weeks, betMarkets, bets } from '../utils/supabase/db'

// An over/under market flattened for the admin Bet Lines screen.
export interface AdminLineView {
  marketId: string
  subjectPlayerId: string
  subjectName: string
  gameNumber: number
  line: number
  status: string            // open | closed | settled | void
  result: string | null     // winning side once settled ('over'|'under'|'push')
}

function mapAdminLine(m: any): AdminLineView {
  const over = m.bet_selections?.find((s: any) => s.key === 'over')
  const under = m.bet_selections?.find((s: any) => s.key === 'under')
  // The winning side at settlement (for display): whichever selection won, else push.
  let result: string | null = null
  if (over?.result === 'won') result = 'over'
  else if (under?.result === 'won') result = 'under'
  else if (over?.result === 'push' || under?.result === 'push') result = 'push'
  return {
    marketId: m.id,
    subjectPlayerId: m.subject_player_id,
    subjectName: m.subject?.name ?? '—',
    gameNumber: m.game_number,
    line: Number(over?.line ?? under?.line ?? 0),
    status: m.status,
    result,
  }
}

export function useBettingAdminData() {
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<AdminLineView[]>([])
  const [betCountByMarket, setBetCountByMarket] = useState<Record<string, number>>({})
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: week } = await weeks.getCurrent()
      const weekId = week?.id ?? null
      setCurrentWeekId(weekId)

      if (!weekId) {
        setLines([])
        setBetCountByMarket({})
        return
      }

      const [marketsRes, betsRes] = await Promise.all([
        betMarkets.listOUByWeek(weekId),
        bets.listByWeek(weekId),
      ])

      setLines((marketsRes.data ?? []).map(mapAdminLine))

      // Count bets per market (each O/U bet is single-leg → one market).
      const counts: Record<string, number> = {}
      for (const b of (betsRes.data ?? []) as any[]) {
        const mid = b.bet_legs?.[0]?.bet_selections?.bet_markets?.id
        if (mid) counts[mid] = (counts[mid] ?? 0) + 1
      }
      setBetCountByMarket(counts)
    } catch (e) {
      console.error('useBettingAdminData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, lines, betCountByMarket, currentWeekId, reload: load }
}
