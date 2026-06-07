// Bounty Board — pure economic helpers + the close-time business rule.
// These mirror the DB's settlement math (BOUNTIES_DB §26, design §13/§14/§26) so
// the UI can preview anti-dilution and payouts without a server round trip. All
// pure + uncached — screens wrap them in useMemo (AGENTS.md §5).

// Client-side mirrors of the RPC validation thresholds (design §34.5, §34.1).
export const MIN_SPONSOR_BOUNTY = 50
export const MIN_HUNTER_STAKE = 25
export const MAX_TITLE_LEN = 80
export const MAX_DESCRIPTION_LEN = 1000

// A hunter's snapshotted protected profit = floor(sponsor bounty / entry order).
export function protectedProfit(sponsorAmount: number, entryNumber: number): number {
  if (entryNumber < 1) return 0
  return Math.floor(sponsorAmount / entryNumber)
}

export interface BountyEconomics {
  totalHunterStakes: number
  totalProtectedProfit: number
  totalHouseSeed: number
  totalPot: number
}

// Pot economics over the current hunters. The House seed only kicks in when the
// summed protected profit outruns the sponsor bounty (early-hunter anti-dilution).
export function bountyEconomics(
  sponsorAmount: number,
  hunters: { stakeAmount: number; protectedProfit: number }[],
): BountyEconomics {
  const totalHunterStakes = hunters.reduce((s, h) => s + h.stakeAmount, 0)
  const totalProtectedProfit = hunters.reduce((s, h) => s + h.protectedProfit, 0)
  const totalHouseSeed = Math.max(0, totalProtectedProfit - sponsorAmount)
  const totalPot = sponsorAmount + totalHunterStakes + totalHouseSeed
  return { totalHunterStakes, totalProtectedProfit, totalHouseSeed, totalPot }
}

// A hunter's payout if the hunters win = their stake back + their protected profit.
export function hunterPayout(stake: number, protectedProfit: number): number {
  return stake + protectedProfit
}

// ── Close-time business rule (design §11) ───────────────────────────────────────
// "Upcoming Monday 7:00 PM America/New_York": this week's Monday 7 PM ET if `now`
// is before it, otherwise the following Monday. Computed in app logic (the DB
// column has no default and the create RPC requires p_closes_at). The ET offset is
// derived explicitly via Intl so DST is handled without a new dependency.

const ET_TZ = 'America/New_York'

// Offset (minutes) of ET from UTC at the given instant — negative (e.g. −300 EST).
function etOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  // Hour can come back as "24" at midnight in some engines — normalize to 0.
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    hour, Number(map.minute), Number(map.second),
  )
  return (asUTC - date.getTime()) / 60000
}

// The UTC instant for a given ET wall-clock moment.
function etWallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const asUTC = Date.UTC(y, mo, d, h, mi)
  const off = etOffsetMinutes(new Date(asUTC))
  return new Date(asUTC - off * 60000)
}

export function defaultBountyCloseAt(now: Date = new Date()): Date {
  // ET wall-clock fields of `now` (read via getUTC* on the shifted instant).
  const et = new Date(now.getTime() + etOffsetMinutes(now) * 60000)
  const dow = et.getUTCDay() // 0 = Sun … 1 = Mon … 6 = Sat
  const daysToMon = (1 - dow + 7) % 7
  let target = etWallToUtc(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() + daysToMon, 19, 0)
  // If that Monday 7 PM has already passed (today is Monday, past 7 PM), roll a week.
  if (target.getTime() <= now.getTime()) {
    target = etWallToUtc(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() + daysToMon + 7, 19, 0)
  }
  return target
}

// Human-readable close time in ET for cards/detail (e.g. "Mon, Jun 9, 7:00 PM ET").
export function formatCloseTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET_TZ,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' ET'
}
