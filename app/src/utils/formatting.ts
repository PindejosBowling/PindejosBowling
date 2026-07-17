// Centralized display formatting for pins, signed amounts, and countdowns/deadlines.
// The single contract for "1,234 pins", "+500", countdown strings, and ET close
// times — previously re-implemented per feature (bets / pvp / bounty / auction).
// Pure + uncached, no data access (AGENTS.md rule 6). The per-feature modules now
// re-export from here for back-compat, so existing import sites keep working.

const ET_TZ = 'America/New_York'

export interface FormatPinsOptions {
  // Prepend '+' on positive amounts (negatives keep their '-'); zero stays bare.
  signed?: boolean
}

// Render a pin amount with thousands separators — the canonical "1,234" contract.
// With `{ signed: true }` it prefixes '+' on positives ("+500"); negatives keep the
// '-' from toLocaleString and zero stays bare ("0"). Callers append " pins" themselves.
export function formatPins(n: number, opts: FormatPinsOptions = {}): string {
  const base = n.toLocaleString()
  return opts.signed && n > 0 ? `+${base}` : base
}

// Signed string for `n`: '+' on positives, bare '-' on negatives, '0' for zero.
// (Moved from utils/bets.ts; kept as a thin alias over formatPins.)
export function signed(n: number): string {
  return formatPins(n, { signed: true })
}

// Display a signed Head-to-Head handicap (pins added to a player's raw score).
// 0 = no handicap ("Scratch"); positives add, negatives subtract. (Moved from utils/pvp.ts.)
export function formatHandicap(n: number): string {
  if (!n) return 'Scratch'
  return n > 0 ? `+${n}` : `${n}`
}

// Compact stake label: a single number when equal, "creator / counterparty" when
// the sides differ. Used in PvP list rows + the negotiation trail. (Moved from utils/pvp.ts.)
export function formatStakes(creatorStake: number, counterpartyStake: number): string {
  return creatorStake !== counterpartyStake
    ? `${formatPins(creatorStake)} / ${formatPins(counterpartyStake)}`
    : formatPins(creatorStake)
}

// Human-readable close time in ET for cards/detail (e.g. "Mon, Jun 9, 7:00 PM ET").
// (Moved from utils/bounty.ts.)
export function formatCloseTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET_TZ,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' ET'
}

// Long-form absolute close time in ET, two lines: "Monday, July 20" over
// "7:00 PM ET". The auction "closes at" contract — full weekday + month so the
// day reads at a glance; formatCloseTime above stays the compact
// bounty/inventory format.
export function formatCloseDateLong(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', {
    timeZone: ET_TZ,
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const time = d.toLocaleTimeString('en-US', {
    timeZone: ET_TZ,
    hour: 'numeric', minute: '2-digit',
  })
  return `${date}\n${time} ET`
}

// Ticking countdown for the detail screen: "01:23:45" (h:mm:ss), with a day
// prefix when needed. Returns null once past zero (the HAMMER FALLING window).
// (Moved from utils/auction.ts.)
export function formatCountdown(targetIso: string, now: Date = new Date()): string | null {
  const ms = new Date(targetIso).getTime() - now.getTime()
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days > 0) return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
