// LaneTalk frame-stat helpers — DISPLAY/PREVIEW ONLY, never money. Line
// seeding lives server-side too now (lanetalk_seed_lines, the prop sync).
//
// Money settlement derives these same four stats server-side via the SQL
// function `lanetalk_game_stats(payload)` (migration
// `20260611160000_lanetalk_prop_settlement.sql`) inside the settlement
// transaction. Keep the formulas here in lockstep with the SQL; if they ever
// drift, the SQL is authoritative — a bug here mis-prices a line (visible
// before settlement), never mis-pays a bet.
//
//   strikes      = frames with is_strike
//   spares       = frames with is_spare
//   cleanPct     = (strikes + spares) / frames × 100
//   firstBallAvg = Σ first-ball pins / frames

import { LanetalkGame } from './index'

// Only the frames matter for stats, so callers can pass a full LanetalkGame or
// a raw `lanetalk_game_imports.payload` shaped down to `{ frames }`.
type FramesOnly = Pick<LanetalkGame, 'frames'>

export interface LanetalkGameStats {
  strikes: number
  spares: number
  /** Percentage 0–100 (not a fraction). */
  cleanPct: number
  firstBallAvg: number
  /** Frames counted — exposed so night aggregation weights by frames. */
  frames: number
}

/** The four bettable stats for one game. Null when the game has no frames
 *  (mirrors the SQL returning NULLs → callers treat as missing data). */
export function gameStats(game: FramesOnly): LanetalkGameStats | null {
  const frames = game.frames.length
  if (!frames) return null
  let strikes = 0
  let spares = 0
  let firstBallTotal = 0
  for (const f of game.frames) {
    if (f.is_strike) strikes += 1
    if (f.is_spare) spares += 1
    firstBallTotal += f.throws[0]?.pins ?? 0
  }
  return {
    strikes,
    spares,
    cleanPct: ((strikes + spares) / frames) * 100,
    firstBallAvg: firstBallTotal / frames,
    frames,
  }
}

/** The same four stats aggregated across a night's (or any set of) games —
 *  frame-level totals, not per-game means, matching the SQL night aggregate. */
export function nightStats(games: FramesOnly[]): LanetalkGameStats | null {
  let strikes = 0
  let spares = 0
  let firstBallWeighted = 0
  let frames = 0
  for (const game of games) {
    const s = gameStats(game)
    if (!s) continue
    strikes += s.strikes
    spares += s.spares
    firstBallWeighted += s.firstBallAvg * s.frames
    frames += s.frames
  }
  if (!frames) return null
  return {
    strikes,
    spares,
    cleanPct: ((strikes + spares) / frames) * 100,
    firstBallAvg: firstBallWeighted / frames,
    frames,
  }
}
