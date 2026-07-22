import { useEffect, useState } from 'react'
import { betMarkets } from '../utils/supabase/db'

// One quote off market_price_line / combo_price_line: the requested line's
// odds (null = out of the priceable band, "line unavailable"), whether it sits
// on a posted rung, the seed anchor, and the half-point band the steppers may
// roam. The underlying distribution never reaches the client.
export interface LineQuote {
  line: number
  odds: number | null
  posted: boolean
  seedLine: number
  seedOdds: number | null
  minLine: number
  maxLine: number
}

// What the value editor is pricing: a posted board market, or a combo member
// set still being composed (no market required).
export type LinePreviewSource =
  | { kind: 'market'; marketId: string }
  | {
      kind: 'combo'
      memberIds: string[]
      stat: string
      seasonId: string
      nGames: number
      weekId: string | null
      gameNumber: number | null
    }
  | null

// Live value-first quote — debounced 250ms per (source, line) change, stale
// responses cancelled. line null → the seed rung (the editor's anchor; also
// how the band is first learned). Display + staging only: placement re-prices
// authoritatively (quote_tolerance) so a stale quote can never bind the book.
export function useLinePreview(
  source: LinePreviewSource,
  line: number | null,
): { quote: LineQuote | null; loading: boolean } {
  const [quote, setQuote] = useState<LineQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const sourceKey = source == null
    ? ''
    : source.kind === 'market'
      ? `m|${source.marketId}`
      : `c|${source.stat}|${source.nGames}|${source.gameNumber ?? 'n'}|${source.weekId ?? ''}|${source.memberIds.join(',')}`

  useEffect(() => {
    if (!source || (source.kind === 'combo' && (source.memberIds.length < 2 || !source.seasonId))) {
      setQuote(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data, error } = source.kind === 'market'
        ? await betMarkets.priceMarketLine(source.marketId, line)
        : await betMarkets.priceComboLine(
            source.memberIds, source.stat, source.seasonId, source.nGames,
            source.weekId, source.gameNumber, line,
          )
      if (cancelled) return
      if (error || !data || typeof data !== 'object') {
        setQuote(null)
        setLoading(false)
        return
      }
      const q = data as Record<string, unknown>
      setQuote({
        line: Number(q.line),
        odds: q.odds == null ? null : Number(q.odds),
        posted: !!q.posted,
        seedLine: Number(q.seed_line),
        seedOdds: q.seed_odds == null ? null : Number(q.seed_odds),
        minLine: Number(q.min_line),
        maxLine: Number(q.max_line),
      })
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [sourceKey, line]) // eslint-disable-line react-hooks/exhaustive-deps

  return { quote, loading }
}
