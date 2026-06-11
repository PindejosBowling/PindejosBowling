// Pure display helpers for bets and pin amounts — shared by BetDetailModal,
// the Active/Settled bet views, and the accounting screens.
import { colors } from '../theme'
import type { BetView } from '../hooks/usePinsinoData'

// Badge from the bet's own status (the target model resolves outcome per bet).
export function resultBadge(status: string) {
  if (status === 'push') return { label: 'PUSH', color: colors.muted }
  if (status === 'won') return { label: 'WON', color: colors.success }
  if (status === 'lost') return { label: 'LOST', color: colors.danger }
  return null
}

// The bet's potential payout — the total returned on a win, incl. the stake.
// Snapshotted at placement (BetView.potentialPayout) and static for the bet's
// lifetime; this is the "to win" figure, independent of the outcome.
export function betPayout(bet: BetView): number {
  return bet.potentialPayout
}

// The realized return to the *player* — the actual pins that flow back once the
// bet settles:
//   won  → the full payout (stake back + winnings)
//   push → the stake, refunded
//   lost → 0 (nothing returns)
// While the bet is still pending nothing has flowed yet → null.
export function betReturn(bet: BetView): number | null {
  if (bet.status === 'won') return bet.potentialPayout
  if (bet.status === 'push' || bet.status === 'void') return bet.stake
  if (bet.status === 'lost') return 0
  return null // pending
}

// Signed string for `n`, '+' on positives, bare '-' on negatives, '0' for zero.
export function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
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
