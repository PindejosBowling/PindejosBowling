// Lanetalk frame-level game data (bundled static reference).
//
// This is test/demo data parsed from a Lanetalk "shared session" page
// (see app/src/scripts/parse_lanetalk.py). It is bundled as a static asset
// rather than stored in Supabase — there is currently a single session for a
// single player. Keyed here by the in-app player display name.

import jordanReticker from './jordanReticker.json'

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
  frames: LanetalkFrame[]
}

export interface LanetalkSession {
  source_url: string | null
  title: string
  player: string
  bowling_center: { name: string; location: string }
  datetime_text: string
  datetime_iso: string | null
  summary: { games: number; total: number; average: number }
  games: LanetalkGame[]
}

// Registry of player display name (lower-cased) -> bundled session.
// "Assume these stats belong to Jordan Reticker." Aliases cover the likely
// in-app display names for that player.
const SESSIONS_BY_PLAYER: Record<string, LanetalkSession> = {}
for (const alias of ['jordan reticker', 'jordan']) {
  SESSIONS_BY_PLAYER[alias] = jordanReticker as LanetalkSession
}

/** Return the bundled Lanetalk session for a player name, or null if none. */
export function getLanetalkSession(name: string | null | undefined): LanetalkSession | null {
  if (!name) return null
  return SESSIONS_BY_PLAYER[name.trim().toLowerCase()] ?? null
}

/** Whether bundled frame-level data exists for the given player name. */
export function hasLanetalkSession(name: string | null | undefined): boolean {
  return getLanetalkSession(name) !== null
}
