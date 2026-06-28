// Bounty Board — pure economic helpers + the close-time business rule.
// These mirror the DB's "All Comers" settlement math so the UI can preview payouts
// without a server round trip. All pure + uncached — screens wrap them in useMemo
// (AGENTS.md §5).
//
// Model: the sponsor takes the SAME bet against each of up to `maxHunters` hunters.
// The sponsor escrows reward*maxHunters up front. Every hunter who wins receives
// stake + reward — identical regardless of join order or count (no dilution). More
// hunters never reduce anyone's payout; with the collective win rule, more hunters
// raise everyone's odds. The House only subsidizes a House-sponsored bounty that
// loses to the hunters.

import { formatCloseTime } from './formatting'

// `formatCloseTime` now lives in utils/formatting.ts; re-exported here for back-compat.
export { formatCloseTime }

// Client-side mirrors of the RPC validation thresholds.
export const MIN_REWARD_PER_HUNTER = 25
export const MIN_HUNTER_STAKE = 25
export const MIN_MAX_HUNTERS = 1
export const MAX_MAX_HUNTERS = 100
export const MAX_TITLE_LEN = 80
export const MAX_DESCRIPTION_LEN = 1000

// The sponsor's total escrow / max liability = reward per hunter × max hunters.
export function sponsorMaxLiability(rewardPerHunter: number, maxHunters: number): number {
  return rewardPerHunter * maxHunters
}

// What a single hunter receives if the hunters win: their stake back + the reward.
export function hunterPayout(stake: number, rewardPerHunter: number): number {
  return stake + rewardPerHunter
}

export interface BountyEconomics {
  totalHunterStakes: number   // n × H
  totalReward: number         // n × R (paid by sponsor escrow / House)
  totalHunterPayout: number   // n × (H + R) — paid to hunters on a hunter win
  sponsorTakeOnWin: number    // n × H — the sponsor's winnings if the sponsor wins
}

// Pot economics over the current hunters.
export function bountyEconomics(
  rewardPerHunter: number,
  hunters: { stakeAmount: number }[],
): BountyEconomics {
  const totalHunterStakes = hunters.reduce((s, h) => s + h.stakeAmount, 0)
  const totalReward = rewardPerHunter * hunters.length
  return {
    totalHunterStakes,
    totalReward,
    totalHunterPayout: totalHunterStakes + totalReward,
    sponsorTakeOnWin: totalHunterStakes,
  }
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

// The upcoming Monday at `hourEt` o'clock ET: this week's Monday if `now` is
// before it, otherwise the following Monday.
export function upcomingMondayCloseAt(hourEt: number, now: Date = new Date()): Date {
  const et = new Date(now.getTime() + etOffsetMinutes(now) * 60000)
  const dow = et.getUTCDay() // 0 = Sun … 1 = Mon … 6 = Sat
  const daysToMon = (1 - dow + 7) % 7
  let target = etWallToUtc(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() + daysToMon, hourEt, 0)
  if (target.getTime() <= now.getTime()) {
    target = etWallToUtc(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() + daysToMon + 7, hourEt, 0)
  }
  return target
}

export function defaultBountyCloseAt(now: Date = new Date()): Date {
  return upcomingMondayCloseAt(19, now)
}
