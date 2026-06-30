import { useState, useCallback, useEffect } from 'react'
import { seasons, pinLedger, loans, loanProducts, loanLedger } from '../utils/supabase/db'
import type { Tables } from '../utils/supabase/database.types'

export type LoanProductView = Tables<'loan_products'> & {
  // Client-side availability hint; the RPC re-checks the full window / max_uses.
  available: boolean
}

export interface DebtLedgerEntry {
  id: string
  amount: number          // signed (see loan_ledger sign convention)
  type: string            // loan_issued | manual_repayment | weekly_garnishment | weekly_interest | season_close_settlement
  description: string
  created_at: string
  weekNumber: number | null
}

export interface ActiveLoanView {
  loanId: string
  product: Tables<'loan_products'>
  outstanding: number     // SUM(loan_ledger.amount) over the loan
  paymentHistory: DebtLedgerEntry[]
}

// One player's loan-shark state: their balance, what they can borrow (when no
// active loan), and their current loan + payment history. No memoization in the
// hook (project rule) — the screen derives display via useMemo.
export function useLoanSharkData(playerId: string | null, viewSeasonId?: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [products, setProducts] = useState<LoanProductView[]>([])
  const [activeLoan, setActiveLoan] = useState<ActiveLoanView | null>(null)

  // True when reviewing a specific prior season — nothing is borrowable.
  const readOnly = viewSeasonId != null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonId = viewSeasonId
        ? (await seasons.getById(viewSeasonId)).data?.id ?? null
        : (await seasons.getCurrent()).data?.id ?? null

      const fetches: PromiseLike<any>[] = []

      let ledgerData: any[] = []
      let myLoansData: any[] = []
      if (playerId && seasonId) {
        fetches.push(
          pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            ledgerData = data ?? []
          }),
          loans.listByPlayer(playerId).then(({ data }) => {
            myLoansData = data ?? []
          })
        )
      }

      let productData: any[] = []
      fetches.push(
        loanProducts.listAvailable().then(({ data }) => {
          productData = data ?? []
        })
      )

      await Promise.all(fetches)

      const playerBalance = ledgerData.reduce((sum, e) => sum + e.amount, 0)

      // The active loan (v1: at most one). Resolve its outstanding + history.
      const activeRow = myLoansData.find((l: any) => l.status === 'active')
      let active: ActiveLoanView | null = null
      if (activeRow && playerId && seasonId) {
        const { data: debtRows } = await loanLedger.listByPlayerSeason(playerId, seasonId)
        const rows = (debtRows ?? []).filter((d: any) => d.loan_id === activeRow.id)
        const outstanding = rows.reduce((sum: number, d: any) => sum + d.amount, 0)
        active = {
          loanId: activeRow.id,
          product: activeRow.loan_products,
          outstanding,
          paymentHistory: rows.map((d: any) => ({
            id: d.id,
            amount: d.amount,
            type: d.type,
            description: d.description,
            created_at: d.created_at,
            weekNumber: (d.weeks as any)?.week_number ?? null,
          })),
        }
      }

      // Availability: a player with an active loan can borrow nothing (v1 = one
      // loan at a time); otherwise every is_active product is offered (the RPC
      // re-checks the window / max_uses / season scope server-side).
      const productViews: LoanProductView[] = productData.map((p: any) => {
        const now = Date.now()
        const fromOk = !p.available_from || new Date(p.available_from).getTime() <= now
        const untilOk = !p.available_until || new Date(p.available_until).getTime() >= now
        const seasonOk = p.season_id == null || p.season_id === seasonId
        // Past-season review is read-only: nothing is borrowable.
        return { ...p, available: !readOnly && !active && fromOk && untilOk && seasonOk }
      })

      setBalance(playerBalance)
      setProducts(productViews)
      setActiveLoan(active)
    } catch (e) {
      console.error('useLoanSharkData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId, viewSeasonId])

  useEffect(() => { load() }, [load])

  return { loading, balance, products, activeLoan, readOnly, reload: load }
}
