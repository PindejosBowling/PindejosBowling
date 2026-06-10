import { useState, useCallback, useEffect } from 'react'
import {
  getLanetalkSession,
  LanetalkSession,
  LanetalkGame,
  LanetalkFrame,
  SessionDate,
  PinDiagram,
} from '../data/lanetalk'

/** Sentinel for the "all nights" filter option. */
export const ALL_DATES = 'all'

// Frame-level game stats for a player. The data is a bundled static asset, so
// "loading" is trivial — the hook keeps the standard shape so the screen reads
// like every other one, and so a future Supabase-backed source can drop in.
export function useFrameStatsData(name: string) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<LanetalkSession | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSession(getLanetalkSession(name))
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => { load() }, [load])

  return { loading, session, reload: load }
}

// ----------------------------------------------------------------------------
// Date filtering (league nights). Every game is stamped with the Monday of its
// week; these helpers drive the date filter on the screen.
// ----------------------------------------------------------------------------

/** Filter options for the screen: "all" plus each distinct league night. */
export function sessionDateOptions(session: LanetalkSession | null): SessionDate[] {
  return session?.dates ?? []
}

/** A session view limited to one league night, or the whole session for ALL_DATES. */
export function filterSessionByDate(
  session: LanetalkSession | null,
  date: string,
): LanetalkSession | null {
  if (!session) return null
  if (date === ALL_DATES) return session
  return { ...session, games: session.games.filter(g => g.date === date) }
}

// ----------------------------------------------------------------------------
// Pure compute functions (uncached — wrap in useMemo at the screen level).
// ----------------------------------------------------------------------------

export interface SessionStats {
  games: number
  total: number
  average: number
  highGame: number
  lowGame: number
  /** Avg pins felled on the first ball of every frame. */
  firstBallAvg: number
  strikes: number
  spares: number
  opens: number
  /** Total scoring frames counted (10 per game). */
  totalFrames: number
  /** strikes / totalFrames. */
  strikePct: number
  /** spares / (spares + opens) — classic spare-conversion rate. */
  sparePct: number
  /** (strikes + spares) / totalFrames — frames with no open. */
  cleanPct: number
  /** First balls that left at least one pin standing. */
  leaves: number
  /** leaves / totalFrames — first balls that weren't strikes. */
  leavePct: number
  splits: number
  /** splits / totalFrames. */
  splitPct: number
  splitsConverted: number
}

/** Iterate the ten scoring frames of a game (the first ball of the 10th counts
 *  once for strike/spare/first-ball math, mirroring a standard scorecard). */
function classifyFrame(f: LanetalkFrame) {
  const firstBall = f.throws[0]?.pins ?? 0
  return {
    firstBall,
    isStrike: f.is_strike,
    isSpare: f.is_spare,
    isOpen: !f.is_strike && !f.is_spare,
    isSplit: f.is_split,
    splitConverted: f.is_split && f.is_spare,
  }
}

export function computeSessionStats(session: LanetalkSession | null): SessionStats | null {
  if (!session || !session.games.length) return null

  const scores = session.games.map(g => g.score)
  let firstBallTotal = 0
  let frameCount = 0
  let strikes = 0
  let spares = 0
  let opens = 0
  let splits = 0
  let splitsConverted = 0

  for (const game of session.games) {
    for (const f of game.frames) {
      const c = classifyFrame(f)
      frameCount += 1
      firstBallTotal += c.firstBall
      if (c.isStrike) strikes += 1
      else if (c.isSpare) spares += 1
      else opens += 1
      if (c.isSplit) splits += 1
      if (c.splitConverted) splitsConverted += 1
    }
  }

  const total = scores.reduce((a, b) => a + b, 0)
  return {
    games: session.games.length,
    total,
    average: Math.round(total / session.games.length),
    highGame: Math.max(...scores),
    lowGame: Math.min(...scores),
    firstBallAvg: frameCount ? firstBallTotal / frameCount : 0,
    strikes,
    spares,
    opens,
    totalFrames: frameCount,
    strikePct: frameCount ? strikes / frameCount : 0,
    sparePct: spares + opens ? spares / (spares + opens) : 0,
    cleanPct: frameCount ? (strikes + spares) / frameCount : 0,
    leaves: frameCount - strikes,
    leavePct: frameCount ? (frameCount - strikes) / frameCount : 0,
    splits,
    splitPct: frameCount ? splits / frameCount : 0,
    splitsConverted,
  }
}

// ----------------------------------------------------------------------------
// Scorecard rendering model.
// ----------------------------------------------------------------------------

export interface ScorecardThrow {
  display: string
  split: boolean
}

export interface ScorecardFrame {
  frame: number
  throws: ScorecardThrow[]
  cumulative: number
  /** Pin state after each ball — one diagram for frames 1-9, one per ball in the 10th. */
  diagrams: PinDiagram[]
}

export interface Scorecard {
  gameNumber: number
  score: number
  dateLabel: string
  frames: ScorecardFrame[]
}

/** Normalize throw boxes for the classic scorecard: a strike sits in the
 *  rightmost box of frames 1-9 (leading box blank); the 10th shows all balls. */
export function computeScorecard(game: LanetalkGame): Scorecard {
  const frames: ScorecardFrame[] = game.frames.map((f) => {
    let boxes: ScorecardThrow[]
    if (f.frame < 10 && f.is_strike) {
      boxes = [{ display: '', split: false }, { display: 'X', split: false }]
    } else {
      boxes = f.throws.map(t => ({ display: t.display, split: t.split }))
    }
    return { frame: f.frame, throws: boxes, cumulative: f.cumulative_score, diagrams: f.pin_diagrams }
  })
  return { gameNumber: game.game_number, score: game.score, dateLabel: game.date_label, frames }
}

// ----------------------------------------------------------------------------
// Pin-leave summary — what's left standing after the first ball, and how often.
// ----------------------------------------------------------------------------

export interface PinLeave {
  /** Sorted USBC pin numbers left standing after the first ball. */
  pins: number[]
  /** Human label, e.g. "10-pin", "7-10 split", "3 pins". */
  label: string
  count: number
  converted: number
}

const NAMED_LEAVES: Record<string, string> = {
  '7,10': '7-10 split',
  '4,6': '4-6 split',
  '4,7,10': 'big four-ish',
  '2,7': '2-7 (baby split)',
  '3,10': '3-10 (baby split)',
}

function leaveLabel(pins: number[]): string {
  if (pins.length === 0) return 'strike'
  if (pins.length === 1) return `${pins[0]}-pin`
  const key = pins.join(',')
  if (NAMED_LEAVES[key]) return NAMED_LEAVES[key]
  return `${pins.length} pins`
}

/** Pins standing after the first ball = everything not knocked down on ball 1. */
function firstBallLeave(frame: LanetalkFrame): number[] {
  const diagram = frame.pin_diagrams[0]
  if (!diagram) return []
  return Object.entries(diagram)
    .filter(([, state]) => state !== 'down_first')
    .map(([pin]) => Number(pin))
    .sort((a, b) => a - b)
}

/** Most-common first-ball leaves across the session, with conversion counts. */
export function computePinLeaves(session: LanetalkSession | null, limit = 6): PinLeave[] {
  if (!session) return []
  const byKey = new Map<string, PinLeave>()

  for (const game of session.games) {
    for (const f of game.frames) {
      if (f.is_strike) continue // nothing left after a strike
      const pins = firstBallLeave(f)
      if (!pins.length) continue
      const key = pins.join(',')
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
        if (f.is_spare) existing.converted += 1
      } else {
        byKey.set(key, {
          pins,
          label: leaveLabel(pins),
          count: 1,
          converted: f.is_spare ? 1 : 0,
        })
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.pins.length - b.pins.length)
    .slice(0, limit)
}
