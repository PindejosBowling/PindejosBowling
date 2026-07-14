// Pure week-by-week loan payoff simulation (no data access; AGENTS.md rule 6 —
// callers wrap in useMemo). Mirrors the DB settlement math in
// process_weekly_loans exactly:
//
//   garnish  = min( ceil(weekly_pinfall × garnishment_rate), debt )
//   debt'    = debt − garnish
//   interest = debt' > 0 ? ceil(debt' × weekly_interest_rate) : 0
//   debt''   = debt' + interest
//
// Weekly pinfall is estimated as the player's season average × GAMES_PER_WEEK;
// the real settlement uses actual game scores, so this is a projection, not a
// promise.

export const MAX_SIMULATED_WEEKS = 10

export interface LoanScheduleWeek {
  week: number // 1-based
  garnished: number // the shark's cut this week
  interest: number // interest added after the cut
  debtAfter: number // what's still owed entering next week
}

export type LoanScheduleStatus =
  // Debt reaches zero within MAX_SIMULATED_WEEKS.
  | 'paid_off'
  // At the cap the debt is not shrinking — steady-state garnish ≤ interest
  // (e.g. Blood in the Water at a low average). The honest "never pays off".
  | 'spiral'
  // Shrinking, but still owing at the cap — just slow.
  | 'truncated'
  // No pinfall estimate available (weeklyPincome <= 0): nothing to simulate.
  | 'no_data'

export interface LoanSchedule {
  weeks: LoanScheduleWeek[]
  status: LoanScheduleStatus
  // Set only when status === 'paid_off'.
  weeksToPayoff: number | null
  totalInterest: number
  totalGarnished: number
}

export function simulateLoanPayoff(params: {
  // Principal (borrow preview) or current outstanding (active loan).
  startingDebt: number
  garnishRate: number
  interestRate: number
  // Estimated pins bowled per week: round(seasonAvg) × GAMES_PER_WEEK.
  weeklyPincome: number
}): LoanSchedule {
  const { startingDebt, garnishRate, interestRate, weeklyPincome } = params

  if (startingDebt <= 0) {
    return { weeks: [], status: 'paid_off', weeksToPayoff: 0, totalInterest: 0, totalGarnished: 0 }
  }
  if (weeklyPincome <= 0) {
    return { weeks: [], status: 'no_data', weeksToPayoff: null, totalInterest: 0, totalGarnished: 0 }
  }

  const weeks: LoanScheduleWeek[] = []
  let debt = startingDebt
  let totalInterest = 0
  let totalGarnished = 0

  for (let w = 1; w <= MAX_SIMULATED_WEEKS && debt > 0; w++) {
    const garnished = Math.min(Math.ceil(weeklyPincome * garnishRate), debt)
    const afterGarnish = debt - garnished
    const interest = afterGarnish > 0 ? Math.ceil(afterGarnish * interestRate) : 0
    debt = afterGarnish + interest
    totalGarnished += garnished
    totalInterest += interest
    weeks.push({ week: w, garnished, interest, debtAfter: debt })
  }

  let status: LoanScheduleStatus
  let weeksToPayoff: number | null = null
  if (debt <= 0) {
    status = 'paid_off'
    weeksToPayoff = weeks.length
  } else {
    // Not shrinking at the cap ⇒ the weekly cut never outruns the interest.
    const last = weeks[weeks.length - 1]
    const prev = weeks.length > 1 ? weeks[weeks.length - 2].debtAfter : startingDebt
    status = last.debtAfter >= prev ? 'spiral' : 'truncated'
  }

  return { weeks, status, weeksToPayoff, totalInterest, totalGarnished }
}
