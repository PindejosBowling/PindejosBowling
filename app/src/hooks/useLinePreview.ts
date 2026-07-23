import { useEffect, useState } from 'react'
import { betMarkets } from '../utils/supabase/db'

// One quote off market_price_line / combo_price_line: the requested line's
// odds (null = out of the priceable band, "line unavailable"), the seed
// anchor, and the half-point band the editor may roam. The underlying
// distribution never reaches the client. (The RPC also returns posted /
// seed_odds — unused client-side, so not carried.)
export interface LineQuote {
  line: number
  odds: number | null
  seedLine: number
  minLine: number
  maxLine: number
}

// A quote only prices the line it was asked about — any other displayed value
// has no odds until re-quoted. One helper so the board, the combine bar, and
// the value sheet all encode that invariant the same way.
export function oddsForLine(quote: LineQuote | null, value: number | null): number | null {
  return quote != null && value != null && quote.line === value ? quote.odds : null
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
  // The quote is stored TAGGED with the source it priced, and only returned
  // while that source is still current — a source switch (different market /
  // member set) hides the old quote on the very same render, so market A's
  // band/odds can never flash on market B's editor (an effect-based clear
  // would lag one render). Line-only changes keep the quote (same market:
  // the band stays valid while the new line re-prices).
  const [held, setHeld] = useState<{ key: string; quote: LineQuote } | null>(null)
  const [loading, setLoading] = useState(false)
  const sourceKey = source == null
    ? ''
    : source.kind === 'market'
      ? `m|${source.marketId}`
      : `c|${source.stat}|${source.nGames}|${source.gameNumber ?? 'n'}|${source.weekId ?? ''}|${source.memberIds.join(',')}`
  const quote = held != null && held.key === sourceKey ? held.quote : null

  useEffect(() => {
    if (!source || (source.kind === 'combo' && (source.memberIds.length < 2 || !source.seasonId))) {
      setHeld(null)
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
        setHeld(null)
        setLoading(false)
        return
      }
      const q = data as Record<string, unknown>
      setHeld({
        key: sourceKey,
        quote: {
          line: Number(q.line),
          odds: q.odds == null ? null : Number(q.odds),
          seedLine: Number(q.seed_line),
          minLine: Number(q.min_line),
          maxLine: Number(q.max_line),
        },
      })
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [sourceKey, line]) // eslint-disable-line react-hooks/exhaustive-deps

  return { quote, loading }
}
