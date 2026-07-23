// Pure display helpers for bets and pin amounts — shared by BetDetailModal,
// the Active/Settled bet views, and the accounting screens.
import { colors } from '../theme'
import type { BetView } from '../hooks/usePinsinoData'
import { signed } from './formatting'

// `signed` now lives in utils/formatting.ts; re-exported here for back-compat.
export { signed }

// Decimal odds as the house multiplier ("×2.40", whole numbers bare "×4").
// Shared by the slip, ticket cards, and the board's priced pick chips.
export const fmtOdds = (n: number) => `×${n.toFixed(n % 1 === 0 ? 0 : 2)}`

// The ▲/▼ direction of `value` relative to `baseline`, with the shared ±0.05
// "on form" dead band — the arrow rides `value` and marks its position vs the
// baseline. One helper so every AVG-vs-BOOK readout (the board strip, the
// combo pane, the combine-mode member rows) shares the same threshold and
// semantics.
export function deltaDir(value: number | null, baseline: number | null): 'up' | 'down' | null {
  if (value == null || baseline == null) return null
  const delta = value - baseline
  return Math.abs(delta) < 0.05 ? null : delta > 0 ? 'up' : 'down'
}

// Badge from the bet's own status (the target model resolves outcome per bet),
// or from an individual leg's result (which adds 'crutched').
export function resultBadge(status: string) {
  if (status === 'push') return { label: 'PUSH', color: colors.muted }
  if (status === 'won') return { label: 'WON', color: colors.success }
  if (status === 'lost') return { label: 'LOST', color: colors.danger }
  // A leg that lost but was cancelled by a Winner's Crutch (dropped from the
  // payout, like a push). Bet status is never 'crutched' — only a leg's result.
  if (status === 'crutched') return { label: 'SAVED 🩼', color: colors.muted }
  return null
}

// The House-funded Energy Drink bonus paid on a win = floor(payout × boost_pct),
// on top of the base payout — the exact 'bet_odds_boost' ledger amount. Reads the
// bet's own boostPct, snapshotted from its flavor's item_catalog.effect_params at
// placement (so varying-boost variants each display their true bonus, and it works
// on the shared board where the owner-RLS'd inventory item is invisible). 0 when no
// Energy Drink is attached. (Boost only pays on a win, so this rides the win/
// pending "to win" figure; it's never added on a push or loss.)
export function betBoostBonus(bet: BetView): number {
  if (bet.boostPct == null) return 0
  return Math.floor(bet.potentialPayout * bet.boostPct)
}

// The bet's potential payout — the total returned on a win, incl. the stake and
// any Energy Drink bonus. The base is snapshotted at placement
// (BetView.potentialPayout) and static for the bet's lifetime; this is the "to
// win" figure, independent of the outcome.
export function betPayout(bet: BetView): number {
  return bet.potentialPayout + betBoostBonus(bet)
}

// The realized return to the *player* — the actual pins that flow back once the
// bet settles:
//   won  → the full payout (stake back + winnings)
//   push → the stake, refunded
//   lost → 0 (nothing returns)
// While the bet is still pending nothing has flowed yet → null.
export function betReturn(bet: BetView): number | null {
  if (bet.status === 'won') return betPayout(bet)
  if (bet.status === 'push' || bet.status === 'void') return bet.stake
  if (bet.status === 'lost') return 0
  return null // pending
}

// The realized return as a player-facing string — `Pending` until the bet settles.
export function betReturnDisplay(bet: BetView): string {
  const r = betReturn(bet)
  return r == null ? 'Pending' : signed(r)
}

// The net pin flow of a bet for a row, signed for the given perspective — this is
// what each BetRow surfaces.
//   Player: +payout on a win (or the to-win preview while pending), −stake on a
//           loss, +stake refunded on a push.
//   House:  the exact mirror (it pays the payout, keeps the lost stake as pincome,
//           refunds the push), so 'house' negates the sign.
export function betReturnText(bet: BetView, perspective: 'player' | 'house' = 'player'): string {
  let amount: number
  if (bet.status === 'push' || bet.status === 'void') amount = bet.stake
  else if (bet.status === 'lost') amount = -bet.stake
  else amount = betPayout(bet) // won or still pending → full payout
  if (perspective === 'house') amount = -amount
  return signed(amount)
}
