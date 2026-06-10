import { useState, useCallback, useEffect } from 'react'
import { lanetalkImports } from '../utils/supabase/db'
import {
  LanetalkSession,
  LanetalkGame,
  LanetalkFrame,
  SessionDate,
  PinDiagram,
  GameClassification,
} from '../data/lanetalk'

/** Sentinel for the "all nights" filter option. */
export const ALL_DATES = 'all'

/** Classification filter: every game, or only one classification. */
export type ClassificationFilter = 'all' | GameClassification
export const ALL_CLASSIFICATIONS: ClassificationFilter = 'all'

// Frame-level game stats for a player, sourced from `lanetalk_game_imports`
// (one row per imported game; `payload` jsonb is a `LanetalkGame`). The rows are
// folded back into a single `LanetalkSession` so the rest of the screen — the
// compute functions and the scorecards — reads exactly as it did off the old
// bundled asset.
export function useFrameStatsData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<LanetalkSession | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!playerId) { setSession(null); return }
      const { data, error } = await lanetalkImports.listByPlayer(playerId)
      if (error) throw error
      setSession(buildSession((data ?? []) as ImportRow[]))
    } catch (e) {
      console.error('useFrameStatsData error:', e)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, session, reload: load }
}

/** Lightweight existence check that gates the PlayerDetail entry point. */
export function useHasFrameStats(playerId: string | null) {
  const [hasFrameStats, setHasFrameStats] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!playerId) { setHasFrameStats(false); return }
    lanetalkImports.countByPlayer(playerId).then(({ count }) => {
      if (!cancelled) setHasFrameStats((count ?? 0) > 0)
    })
    return () => { cancelled = true }
  }, [playerId])

  return hasFrameStats
}

// ----------------------------------------------------------------------------
// Session assembly — fold the per-game import rows into one session.
// ----------------------------------------------------------------------------

/** The stored `payload` jsonb mirrors a parsed game (with a few nullable fields
 *  for partial games); the import row also carries denormalized scalars. */
type ImportRow = {
  game_number: number
  score: number | null
  played_at: string | null
  source_url: string
  classification: GameClassification
  payload: any
}

/** Coerce a stored game payload into the screen's non-null `LanetalkGame`. */
function payloadToGame(row: ImportRow): LanetalkGame {
  const p = row.payload ?? {}
  const frames: LanetalkFrame[] = (p.frames ?? []).map((f: any): LanetalkFrame => ({
    frame: f.frame,
    throws: (f.throws ?? []).map((t: any) => ({
      display: t.display ?? '',
      pins: t.pins ?? 0,
      split: !!t.split,
    })),
    cumulative_score: f.cumulative_score ?? 0,
    is_strike: !!f.is_strike,
    is_spare: !!f.is_spare,
    is_split: !!f.is_split,
    pin_diagrams: (f.pin_diagrams ?? []) as PinDiagram[],
  }))
  return {
    game_number: row.game_number,
    score: row.score ?? p.score ?? 0,
    classification: row.classification,
    date: p.date ?? '',
    date_label: p.date_label ?? '',
    played_at: row.played_at ?? p.played_at ?? null,
    source_url: row.source_url ?? p.source_url ?? null,
    frames,
  }
}

function buildSession(rows: ImportRow[]): LanetalkSession | null {
  if (!rows.length) return null
  const games = rows.map(payloadToGame)

  // Distinct league nights, chronological (rows already arrive oldest-first).
  const seen = new Set<string>()
  const dates: SessionDate[] = []
  for (const g of games) {
    if (g.date && !seen.has(g.date)) {
      seen.add(g.date)
      dates.push({ date: g.date, label: g.date_label || g.date })
    }
  }

  const total = games.reduce((a, g) => a + g.score, 0)
  return {
    player: '',
    dates,
    summary: {
      games: games.length,
      total,
      average: games.length ? Math.round(total / games.length) : 0,
    },
    games,
  }
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

/** A session view limited to one classification (official/recreational), or the
 *  whole session for ALL_CLASSIFICATIONS. The league-night list is recomputed so
 *  the date filter only offers nights that survive the classification cut. */
export function filterSessionByClassification(
  session: LanetalkSession | null,
  classification: ClassificationFilter,
): LanetalkSession | null {
  if (!session) return null
  if (classification === ALL_CLASSIFICATIONS) return session
  const games = session.games.filter(g => g.classification === classification)
  const seen = new Set<string>()
  const dates: SessionDate[] = []
  for (const g of games) {
    if (g.date && !seen.has(g.date)) {
      seen.add(g.date)
      dates.push({ date: g.date, label: g.date_label || g.date })
    }
  }
  return { ...session, games, dates }
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
