// Shared display helpers for the PvP Challenge Contracts feature. Keeps the
// contract-type / status vocabulary in one place so every screen labels them the
// same way. Winner takes the whole pot — there is no rake, so payout = pot.

export const PVP_MIN_STAKE = 10

export type PvpContractType = 'line_duel' | 'prop_duel' | 'raw_score_duel' | 'custom'

export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  line_duel: 'Line Duel',
  prop_duel: 'Prop Duel',
  raw_score_duel: 'Raw Score Duel',
  custom: 'Custom',
}

// One-line settlement rule, in plain words, shown on create + detail.
export const CONTRACT_TYPE_RULE: Record<string, string> = {
  line_duel:
    'Each bowler is measured against their own projected line. Whoever beats their ' +
    'line by more wins the pot. A tie pushes and both stakes are refunded.',
  prop_duel:
    'Both players take opposite sides of the same prop. The side the result lands ' +
    'on wins the pot. A market push refunds both stakes.',
  raw_score_duel:
    'Highest raw game score wins the pot — no lines, no handicap. A tie pushes and ' +
    'both stakes are refunded.',
  custom:
    'A custom challenge — the creator defines the win condition. Settled manually ' +
    'by an admin based on the stated terms. There is no automatic scoring.',
}

// Selectable contract types in the UI. Prop Duel is intentionally hidden for now
// (the DB still supports prop_duel; CONTRACT_TYPE_LABEL/RULE keep its strings so
// any legacy prop_duel rows still render).
export const CONTRACT_TYPE_OPTIONS: { key: PvpContractType; label: string }[] = [
  { key: 'line_duel', label: 'Line' },
  { key: 'raw_score_duel', label: 'Raw Score' },
  { key: 'custom', label: 'Custom' },
]

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
