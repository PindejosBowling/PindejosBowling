// match.ts — pure matching helpers for the Lanetalk importer.
//
//  1. Fuzzy-match the Lanetalk bowler name to a league player who holds a
//     non-fill team_slot in that week (after stripping "pbl" / "-pbl" tokens).
//  2. Classify each parsed game Official vs Recreational by matching its total
//     score against the player's recorded official scores for the week.

import type { LanetalkGame } from './parseLanetalk.ts'

export interface SlotCandidate {
  playerId: string
  teamSlotId: string
  name: string
}

export interface PlayerMatch {
  playerId: string
  teamSlotId: string
  name: string
  similarity: number
}

/** lowercase, strip every "pbl"/"-pbl" token, reduce punctuation to spaces, collapse. */
export function normalizeBowlerName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/-?pbl-?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/**
 * Token-aware name similarity: the better of whole-string similarity and the
 * average best-token match driven by the bowler name. Lanetalk names are often
 * just a first name / nickname (e.g. "JORDAN-PBL" -> "jordan"), which must still
 * match a full league name ("jordan reticker") — whole-string Levenshtein alone
 * would not.
 */
export function nameSimilarity(a: string, b: string): number {
  const whole = similarity(a, b)
  const ta = a.split(' ').filter(Boolean)
  const tb = b.split(' ').filter(Boolean)
  if (!ta.length || !tb.length) return whole
  const perToken = ta.map(t => Math.max(...tb.map(u => similarity(t, u))))
  const tokenAvg = perToken.reduce((s, x) => s + x, 0) / perToken.length
  return Math.max(whole, tokenAvg)
}

/** Best non-fill-slot candidate at or above `threshold`, else null. */
export function matchPlayer(
  bowlerName: string,
  candidates: SlotCandidate[],
  threshold = 0.8,
): PlayerMatch | null {
  const target = normalizeBowlerName(bowlerName)
  if (!target) return null
  let best: PlayerMatch | null = null
  for (const c of candidates) {
    const sim = nameSimilarity(target, normalizeBowlerName(c.name))
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { playerId: c.playerId, teamSlotId: c.teamSlotId, name: c.name, similarity: sim }
    }
  }
  return best
}

export interface ClassifiedGame {
  game: LanetalkGame
  classification: 'official' | 'recreational'
}

/**
 * Greedy one-to-one classification in play order: a parsed game whose total
 * equals an as-yet-unconsumed official score is Official; the rest Recreational.
 * With no official scores (e.g. unmatched player) every game is Recreational.
 */
export function classifyGames(games: LanetalkGame[], officialScores: number[]): ClassifiedGame[] {
  const remaining = [...officialScores]
  const ordered = [...games].sort((a, b) => {
    const ta = a.played_at ?? ''
    const tb = b.played_at ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.game_number - b.game_number
  })
  const result = new Map<LanetalkGame, ClassifiedGame>()
  for (const game of ordered) {
    const idx = game.score == null ? -1 : remaining.indexOf(game.score)
    if (idx >= 0) {
      remaining.splice(idx, 1)
      result.set(game, { game, classification: 'official' })
    } else {
      result.set(game, { game, classification: 'recreational' })
    }
  }
  // Preserve the caller's original game order in the output.
  return games.map(g => result.get(g)!)
}
