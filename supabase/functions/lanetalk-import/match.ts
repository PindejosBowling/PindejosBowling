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
  /**
   * Every non-fill slot the matched player holds that week. Usually one, but a
   * player can be slotted on two teams in a single week — a given Lanetalk
   * session then belongs to exactly one of these (disambiguated by `chooseSlot`).
   */
  teamSlotIds: string[]
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

/**
 * Best-matching league player (by name) at or above `threshold`, else null.
 * Returns *all* of that player's non-fill slots for the week — a player slotted
 * on two teams contributes two candidates that share one `playerId`; collapsing
 * to a single slot here would misattribute the session that belongs to the other
 * slot. `chooseSlot` later narrows to the one slot this session actually is.
 */
export function matchPlayer(
  bowlerName: string,
  candidates: SlotCandidate[],
  threshold = 0.8,
): PlayerMatch | null {
  const target = normalizeBowlerName(bowlerName)
  if (!target) return null
  let best: { playerId: string; name: string; similarity: number } | null = null
  for (const c of candidates) {
    const sim = nameSimilarity(target, normalizeBowlerName(c.name))
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { playerId: c.playerId, name: c.name, similarity: sim }
    }
  }
  if (!best) return null
  const teamSlotIds = candidates
    .filter(c => c.playerId === best!.playerId)
    .map(c => c.teamSlotId)
  return { playerId: best.playerId, teamSlotIds, name: best.name, similarity: best.similarity }
}

/** How many of `b`'s values can be matched one-to-one against `a` (multiset overlap). */
function multisetOverlap(a: number[], b: number[]): number {
  const remaining = [...a]
  let count = 0
  for (const x of b) {
    const idx = remaining.indexOf(x)
    if (idx >= 0) {
      remaining.splice(idx, 1)
      count++
    }
  }
  return count
}

/** One recorded official score and the league game it belongs to (games.game_number). */
export interface OfficialScore {
  gameNumber: number
  score: number
}

export interface SlotOfficialScores {
  teamSlotId: string
  /** This slot's official scores, ordered by the league game number (game 1, 2, …). */
  officialScores: OfficialScore[]
}

/** Play order: by played_at (nulls last), then the Lanetalk session position. */
function byPlayOrder(a: LanetalkGame, b: LanetalkGame): number {
  const ta = a.played_at ?? ''
  const tb = b.played_at ?? ''
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.game_number - b.game_number
}

/**
 * Pick which of a matched player's slots a single Lanetalk session belongs to.
 * One slot → that slot (unchanged behaviour). Multiple slots (player bowled on
 * two teams) → the slot whose recorded official scores best overlap this
 * session's game totals, since the session is one team's set of games. Ties or
 * no signal fall back to the first slot (stable input order).
 */
export function chooseSlot(
  games: LanetalkGame[],
  slots: SlotOfficialScores[],
): SlotOfficialScores | null {
  if (slots.length === 0) return null
  if (slots.length === 1) return slots[0]
  const sessionScores = games
    .map(g => g.score)
    .filter((s): s is number => s != null)
  let best = slots[0]
  let bestOverlap = -1
  for (const slot of slots) {
    const overlap = multisetOverlap(sessionScores, slot.officialScores.map(o => o.score))
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = slot
    }
  }
  return best
}

export interface ClassifiedGame {
  game: LanetalkGame
  classification: 'official' | 'recreational'
  /**
   * The game's resolved number. Official games take their league game number
   * (from the matched recorded score); recreational games are numbered
   * sequentially after the highest official number, in play order. Unique within
   * a session, so it can be stored directly as game_number.
   */
  gameNumber: number
}

/**
 * Classify + number games against the slot's official scores by an ordered
 * (positional) subsequence match rather than an any-position value match. Walk
 * the session's games in play order alongside the official scores in league game
 * order: each game whose total equals the next still-unmatched official score is
 * Official and takes that league game number; the pointer then advances.
 * Everything else is Recreational and, in a second pass, is numbered sequentially
 * starting just past the highest official game number. Because the league
 * ordering is authoritative, duplicate totals resolve positionally — official
 * games never "conflict". With no official scores (e.g. unmatched player) every
 * game is Recreational, numbered 1..N in play order.
 */
export function classifyGames(games: LanetalkGame[], officialScores: OfficialScore[]): ClassifiedGame[] {
  const ordered = [...games].sort(byPlayOrder)
  const result = new Map<LanetalkGame, ClassifiedGame>()
  // Pass 1: official subsequence match — officials take their league game number.
  let ptr = 0
  let maxOfficial = 0
  for (const game of ordered) {
    if (ptr < officialScores.length && game.score != null && game.score === officialScores[ptr].score) {
      const gameNumber = officialScores[ptr].gameNumber
      result.set(game, { game, classification: 'official', gameNumber })
      if (gameNumber > maxOfficial) maxOfficial = gameNumber
      ptr++
    } else {
      result.set(game, { game, classification: 'recreational', gameNumber: 0 })
    }
  }
  // Pass 2: number recreational games sequentially after the last official one.
  let recNext = maxOfficial + 1
  for (const game of ordered) {
    const c = result.get(game)!
    if (c.classification === 'recreational') c.gameNumber = recNext++
  }
  // Preserve the caller's original game order in the output.
  return games.map(g => result.get(g)!)
}
