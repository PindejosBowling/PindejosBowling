// Centralized ledger aggregation — the single place a pin_ledger (or loan_ledger)
// slice becomes a number. Balance is the most load-bearing figure in the economy
// UI, so its aggregation rule lives here (and this is the hook for any future
// filtering, e.g. excluding pending holds). Pure + uncached, no data access
// (AGENTS.md rule 6) — previously re-implemented inline in 8 hooks.

interface AmountRow {
  amount: number
}

// Sum a ledger slice into a balance. Accepts null/undefined so callers can pass
// query results straight through without defaulting.
export function computeBalance(rows: AmountRow[] | null | undefined): number {
  return (rows ?? []).reduce((sum, e) => sum + e.amount, 0)
}

// Sum a loan_ledger slice into the outstanding debt for a loan. Same aggregation
// as computeBalance; named separately because debt and balance are different
// economic quantities that happen to share a formula today.
export function computeDebt(rows: AmountRow[] | null | undefined): number {
  return computeBalance(rows)
}
