// Shared display helpers for the PvP Challenge Contracts feature. Keeps the
// contract-type / status vocabulary in one place so every screen labels them the
// same way. Winner takes the whole pot — there is no rake, so payout = pot.

export const PVP_MIN_STAKE = 10

export type PvpContractType = 'line_duel' | 'prop_duel' | 'head_to_head' | 'custom'

export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  line_duel: 'Line Duel',
  prop_duel: 'Prop Duel',
  head_to_head: 'Head-to-Head',
  custom: 'Custom',
}

// One-line settlement rule, in plain words, shown on create + detail.
export const CONTRACT_TYPE_RULE: Record<string, string> = {
  line_duel:
    'Each bowler is measured against their own projected line for the game. Whoever beats their ' +
    'line by more wins the pot. A tie pushes and both stakes are refunded.',
  prop_duel:
    'Both players take opposite sides of the same prop. The side the result lands ' +
    'on wins the pot. A market push refunds both stakes.',
  head_to_head:
    "Each bowler's raw game score plus their assigned handicap is compared — the " +
    'higher adjusted total wins the pot. A handicap is optional (0 = none) and a tie ' +
    'pushes, refunding both stakes.',
  custom:
    'A custom challenge — the creator defines the win condition. Settled manually ' +
    'by an admin based on the stated terms. There is no automatic scoring.',
}

// Selectable contract types in the UI. Prop Duel is intentionally hidden for now
// (the DB still supports prop_duel; CONTRACT_TYPE_LABEL/RULE keep its strings so
// any legacy prop_duel rows still render).
export const CONTRACT_TYPE_OPTIONS: { key: PvpContractType; label: string }[] = [
  { key: 'line_duel', label: 'Line Duel' },
  { key: 'head_to_head', label: 'Head-to-Head' },
  { key: 'custom', label: 'Custom' },
]

// Display a signed Head-to-Head handicap (pins added to a player's raw score).
// 0 = no handicap; positives add, negatives subtract.
export function formatHandicap(n: number): string {
  if (!n) return 'Scratch'
  return n > 0 ? `+${n}` : `${n}`
}

// Sanitize a handicap text input to a signed integer string: digits with an
// optional single leading minus ("" and "-" are valid in-progress values → 0).
export function sanitizeHandicap(v: string): string {
  const digits = v.replace(/[^0-9]/g, '')
  return (v.trimStart().startsWith('-') ? '-' : '') + digits
}

// True when the two sides put up different amounts (asymmetric stakes).
export function isAsymmetricStakes(creatorStake: number, counterpartyStake: number): boolean {
  return creatorStake !== counterpartyStake
}

// Compact stake label: a single number when equal, "creator / counterparty" when
// the sides differ. Used in list rows + the negotiation trail where space is tight.
export function formatStakes(creatorStake: number, counterpartyStake: number): string {
  return isAsymmetricStakes(creatorStake, counterpartyStake)
    ? `${creatorStake.toLocaleString()} / ${counterpartyStake.toLocaleString()}`
    : creatorStake.toLocaleString()
}

// status → { label, color-key }. The screen maps the color key to a theme color.
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  countered: 'Countered',
  locked: 'Active',
  accepted: 'Active',
  settled: 'Settled',
  pushed: 'Push',
  voided: 'Voided',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

// 'live' = still negotiable, 'active' = escrowed/locked, 'done' = resolved.
export function statusKind(status: string): 'live' | 'active' | 'done' {
  if (status === 'pending' || status === 'countered') return 'live'
  if (status === 'locked' || status === 'accepted') return 'active'
  return 'done'
}
