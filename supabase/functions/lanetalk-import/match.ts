// match.ts — pure matching helpers for the Lanetalk importer.
//
//  1. Fuzzy-match the Lanetalk bowler name to a league player who holds a
//     non-fill team_slot in that week (after stripping "pbl" / "-pbl" tokens).
//  2. Classify each parsed game Official vs Recreational by matching its total
//     score against the player's recorded official scores for the week.

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

/**
 * Pick which of a matched player's slots a Lanetalk night belongs to.
 * One slot → that slot (unchanged behaviour). Multiple slots (player bowled on
 * two teams) → the slot whose recorded official scores best overlap the night's
 * game totals. Ties or no signal fall back to the first slot (stable input
 * order). Pass the *combined* night's games (across every link), not one link's.
 */
export function chooseSlot(
  games: { score: number | null }[],
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

/** One game in a player's combined night, drawn from any of their links. */
export interface NightGameInput {
  /** Stable identity for mapping the result back (e.g. `${sourceUrl}#${pos}`). */
  key: string
  /** The link this game came from. */
  sourceUrl: string
  /** Raw Lanetalk position within its own session (1..N per link). */
  sessionPosition: number
  score: number | null
  /** Session start time (per-link in Lanetalk, not per-game). */
  playedAt: string | null
}

export interface NightAssignment {
  key: string
  classification: 'official' | 'recreational'
  /**
   * Resolved game number, unique across the player's whole week. Official games
   * take their league game number; recreational games are numbered sequentially
   * after the highest official number, in night order.
   */
  gameNumber: number
}

/**
 * Global play order across one player's links for a single league night: by
 * played_at (nulls last), then source url, then session position. Lane-switch
 * nights split a player's games across several links, each with its own session
 * clock — this stitches them into one stable order.
 */
function byNightOrder(a: NightGameInput, b: NightGameInput): number {
  const ta = a.playedAt ?? '￿'
  const tb = b.playedAt ?? '￿'
  if (ta !== tb) return ta < tb ? -1 : 1
  if (a.sourceUrl !== b.sourceUrl) return a.sourceUrl < b.sourceUrl ? -1 : 1
  return a.sessionPosition - b.sessionPosition
}

/**
 * Classify + number a player's *entire* league night (every link combined)
 * against their recorded official scores. Matching is value-based, not
 * positional: for each official score in league game-number order, the earliest
 * still-unmatched game in night order with that exact total is Official and
 * takes that league game number. This is what makes a lane-switch night work —
 * an official game on the 2nd link is found regardless of where that link sits
 * in the order, and duplicate totals (e.g. 132 / 132) resolve to consecutive
 * league numbers. Everything unmatched is Recreational, numbered sequentially
 * after the highest official number, in night order. With no official scores
 * (e.g. unmatched player) every game is Recreational, numbered 1..N.
 *
 * Numbers are unique across the combined input, so the (source_url, game_number)
 * uniqueness on lanetalk_game_imports never collides across a player's links.
 */
export function classifyNight(games: NightGameInput[], officialScores: OfficialScore[]): NightAssignment[] {
  const ordered = [...games].sort(byNightOrder)
  const matched = new Set<string>()
  const result = new Map<string, NightAssignment>()
  let maxOfficial = 0
  // Official pass: value match in league game-number order; earliest unmatched wins.
  const officials = [...officialScores].sort((a, b) => a.gameNumber - b.gameNumber)
  for (const off of officials) {
    const hit = ordered.find(g => !matched.has(g.key) && g.score != null && g.score === off.score)
    if (!hit) continue
    matched.add(hit.key)
    result.set(hit.key, { key: hit.key, classification: 'official', gameNumber: off.gameNumber })
    if (off.gameNumber > maxOfficial) maxOfficial = off.gameNumber
  }
  // Recreational pass: number leftovers after the last official, in night order.
  let recNext = maxOfficial + 1
  for (const g of ordered) {
    if (matched.has(g.key)) continue
    result.set(g.key, { key: g.key, classification: 'recreational', gameNumber: recNext++ })
  }
  // Preserve the caller's original input order in the output.
  return games.map(g => result.get(g.key)!)
}
