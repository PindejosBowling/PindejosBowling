// Lanetalk frame-level game model (shapes only).
//
// These types describe the per-game payload parsed from a Lanetalk "shared
// session" page and stored in the `lanetalk_game_imports` table (one row per
// game; `payload` jsonb mirrors a `LanetalkGame`). The data is fetched from
// Supabase by `useFrameStatsData`; this module holds only the shared shapes.

export type PinState = 'down_first' | 'down_second' | 'standing'

/** A diagram maps each USBC pin number (1-10, as string keys) to its fate. */
export type PinDiagram = Record<string, PinState>

export interface LanetalkThrow {
  /** On-screen token: a digit, "X" (strike), "/" (spare) or "-" (miss). */
  display: string
  /** Pins felled by this ball. */
  pins: number
  /** True when this ball left/started a split (red-circled count). */
  split: boolean
}

export interface LanetalkFrame {
  frame: number
  throws: LanetalkThrow[]
  cumulative_score: number
  is_strike: boolean
  is_spare: boolean
  is_split: boolean
  /** One diagram per frame (1-9), one per ball in the 10th. */
  pin_diagrams: PinDiagram[]
}

export interface LanetalkGame {
  game_number: number
  score: number
  /** Monday of the league night this game belongs to (YYYY-MM-DD). */
  date: string
  /** Human label for that Monday, e.g. "Jun 8, 2026". */
  date_label: string
  /** Original upload timestamp (ISO) — used only to order games by play time. */
  played_at: string | null
  /** The Lanetalk share link this game was parsed from. */
  source_url: string | null
  frames: LanetalkFrame[]
}

export interface SessionDate {
  /** YYYY-MM-DD (Monday of the week). */
  date: string
  label: string
}

export interface LanetalkSession {
  player: string
  /** Not stored per-game in the import table; absent for Supabase-sourced data. */
  bowling_center?: { name: string; location: string }
  /** Distinct league nights present in `games`, chronological. */
  dates: SessionDate[]
  summary: { games: number; total: number; average: number }
  games: LanetalkGame[]
}
