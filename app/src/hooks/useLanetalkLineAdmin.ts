import { useState } from 'react'
import { betMarkets, games, scores, teamSlots, rsvp, lanetalkImports } from '../utils/supabase/db'
import type { TablesInsert } from '../utils/supabase/database.types'
import { gameStats, nightStats } from '../data/lanetalk/stats'
import { STAT_LABELS } from './usePinsinoData'

// LaneTalk stat-line generation — admin client-side writes (no sync function).
//
// "Generate Stat Lines" creates the week's prop markets: strikes + spares O/U
// per eligible (player, game), clean% + first-ball avg O/U per eligible player
// for the night. Idempotent + re-runnable: existing markets (any status) are
// skipped; markets whose subject/game fell off the eligibility ladder are
// DELETEd (the refund_bets_before_market_delete trigger refunds bets whole).
//
// Eligibility = the O/U sync's ladder (participation `scores` rows when games
// exist, else team slots, else RSVP 'in' × games 1–2) **∩ players with ≥1
// official import**. There is NO league-average or default fallback — a player
// with no imported official games simply has no stat lines (and any leftovers
// from before their imports were removed get pruned).
//
// Line seeding is priced off the player's OFFICIAL imports only. Re-runs also
// REPRICE markets whose seeded line drifted — but only unbet ones (never move
// a line under a placed bet). Pricing is display-risk only: settlement derives
// actuals server-side (settle_lanetalk_props_for_week), never from these
// numbers.
//
// Caveat (documented in context/lanetalk-stat-bets.md): there is no
// server-side roster coupling for props — roster changes after generation need
// an admin re-tap (or the Confirm flow voids strays).

type StatKey = 'strikes' | 'spares' | 'clean_pct' | 'first_ball_avg'
const GAME_STATS: StatKey[] = ['strikes', 'spares']
const NIGHT_STATS: StatKey[] = ['clean_pct', 'first_ball_avg']

// Rounding policy (TODO/design): counts land on a half so they can't push;
// clean% lands between the 5%-multiples a 20-frame night can produce; the
// first-ball avg keeps one decimal (a rare exact push refunds normally).
const countLine = (avg: number) => Math.min(9.5, Math.max(0.5, Math.floor(avg) + 0.5))
const cleanLine = (avg: number) => Math.floor(avg / 5) * 5 + 2.5
const fbaLine = (avg: number) => Math.round(avg * 10) / 10

interface SeedAverages {
  strikesPerGame: number
  sparesPerGame: number
  cleanPct: number
  firstBallAvg: number
}

function linesFromAverages(a: SeedAverages): Record<StatKey, number> {
  return {
    strikes: countLine(a.strikesPerGame),
    spares: countLine(a.sparesPerGame),
    clean_pct: cleanLine(a.cleanPct),
    first_ball_avg: fbaLine(a.firstBallAvg),
  }
}

// Frame-weighted averages across a set of import payloads (clean% / first-ball
// avg), plus per-game count means — the same aggregation the FrameStats screen
// shows, via the shared stats module.
function averagesFromPayloads(payloads: any[]): SeedAverages | null {
  const frameGames = payloads
    .map(p => ({ frames: p?.frames ?? [] }))
    .filter(g => g.frames.length > 0)
  const agg = nightStats(frameGames)
  if (!agg) return null
  return {
    strikesPerGame: agg.strikes / frameGames.length,
    sparesPerGame: agg.spares / frameGames.length,
    cleanPct: agg.cleanPct,
    firstBallAvg: agg.firstBallAvg,
  }
}

export interface GenerateStatLinesResult {
  created: number
  pruned: number
  repriced: number
  skipped: number
}

export function useLanetalkLineAdmin() {
  const [generating, setGenerating] = useState(false)

  async function generateStatLines(
    weekId: string,
  ): Promise<{ result?: GenerateStatLinesResult; error?: string }> {
    setGenerating(true)
    try {
      const [gamesRes, scoresRes, slotsRes, rsvpRes, importsRes, existingRes] = await Promise.all([
        games.listByWeek(weekId),
        scores.listByWeek(weekId),
        teamSlots.listByWeek(weekId),
        rsvp.listByWeek(weekId),
        lanetalkImports.listOfficial(),
        betMarkets.listLanetalkPropsByWeek(weekId),
      ])
      const firstError =
        gamesRes.error ?? scoresRes.error ?? slotsRes.error ?? rsvpRes.error ??
        importsRes.error ?? existingRes.error
      if (firstError) return { error: firstError.message }

      const gameRows = gamesRes.data ?? []
      const slotRows = slotsRes.data ?? []
      const rsvpRows = rsvpRes.data ?? []
      const importRows = importsRes.data ?? []
      const existingRows = existingRes.data ?? []

      // Subject names (slots cover the scores path; RSVP covers the pre-team path).
      const nameByPlayer = new Map<string, string>()
      for (const s of slotRows as any[]) {
        if (s.player_id) nameByPlayer.set(s.player_id, s.players?.name ?? '—')
      }
      for (const r of rsvpRows as any[]) {
        if (r.player_id && !nameByPlayer.has(r.player_id)) {
          nameByPlayer.set(r.player_id, r.players?.name ?? '—')
        }
      }

      // Eligibility ladder (mirrors sync_over_under_markets_for_week): per-game
      // participation rows once games exist, else slots × games, else RSVP × games.
      const gameNumberById = new Map<string, number>(
        (gameRows as any[]).map(g => [g.id, g.game_number]),
      )
      const targetGames = gameRows.length
        ? [...new Set((gameRows as any[]).map(g => g.game_number as number))].sort((a, b) => a - b)
        : [1, 2]
      const pairs = new Set<string>() // `${playerId}|${gameNumber}`
      if (gameRows.length) {
        for (const s of scoresRes.data ?? [] as any[]) {
          const pid = (s as any).team_slots?.player_id
          const gn = gameNumberById.get((s as any).game_id)
          if (pid && gn != null) pairs.add(`${pid}|${gn}`)
        }
      } else if (slotRows.length) {
        for (const s of slotRows as any[]) {
          if (s.player_id) for (const gn of targetGames) pairs.add(`${s.player_id}|${gn}`)
        }
      } else {
        for (const r of rsvpRows as any[]) {
          if (r.status === 'in' && r.player_id) {
            for (const gn of targetGames) pairs.add(`${r.player_id}|${gn}`)
          }
        }
      }
      // Seed lines strictly from each player's own official history — one game
      // is sufficient; no league-average or default fallback. A player with no
      // usable official imports gets NO entry here, and therefore no markets.
      const payloadsByPlayer = new Map<string, any[]>()
      for (const r of importRows as any[]) {
        if (!r.player_id) continue
        const arr = payloadsByPlayer.get(r.player_id)
        if (arr) arr.push(r.payload)
        else payloadsByPlayer.set(r.player_id, [r.payload])
      }
      const linesByPlayer = new Map<string, Record<StatKey, number>>()
      for (const pid of new Set([...pairs].map(p => p.split('|')[0]))) {
        const own = averagesFromPayloads(payloadsByPlayer.get(pid) ?? [])
        if (own) linesByPlayer.set(pid, linesFromAverages(own))
      }
      const subjects = new Set(linesByPlayer.keys())

      // Desired market set, keyed `${playerId}|${gameNumber ?? 'night'}|${stat}`.
      const desired = new Map<string, { playerId: string; gameNumber: number | null; stat: StatKey }>()
      for (const pair of pairs) {
        const [pid, gnStr] = pair.split('|')
        if (!subjects.has(pid)) continue
        for (const stat of GAME_STATS) {
          desired.set(`${pid}|${gnStr}|${stat}`, { playerId: pid, gameNumber: Number(gnStr), stat })
        }
      }
      for (const pid of subjects) {
        for (const stat of NIGHT_STATS) {
          desired.set(`${pid}|night|${stat}`, { playerId: pid, gameNumber: null, stat })
        }
      }

      const existingKey = (m: any) =>
        `${m.subject_player_id}|${m.game_number ?? 'night'}|${m.params?.stat}`
      const existingKeys = new Set((existingRows as any[]).map(existingKey))

      // Prune ineligible leftovers (open/closed only — settled markets are
      // immutable history). The DELETE refunds every touched bet whole.
      const staleIds = (existingRows as any[])
        .filter(m => (m.status === 'open' || m.status === 'closed') && !desired.has(existingKey(m)))
        .map(m => m.id)
      if (staleIds.length > 0) {
        const { error } = await betMarkets.removeMarkets(staleIds)
        if (error) return { error: error.message }
      }

      // Reprice kept markets whose seeded line drifted (new imports since the
      // last run) — UNBET ones only: a line never moves under a placed bet.
      let repriced = 0
      for (const m of existingRows as any[]) {
        const d = desired.get(existingKey(m))
        if (!d || (m.status !== 'open' && m.status !== 'closed')) continue
        const want = linesByPlayer.get(d.playerId)?.[d.stat]
        const sels: any[] = m.bet_selections ?? []
        const current = sels[0]?.line != null ? Number(sels[0].line) : null
        const hasBets = sels.some(s => (s.bet_legs ?? []).length > 0)
        if (want == null || current === want || hasBets) continue
        const { error } = await betMarkets.setSelectionLineByMarket(m.id, want)
        if (error) return { error: error.message }
        repriced += 1
      }

      // Create what's missing.
      const toCreate = [...desired.entries()].filter(([key]) => !existingKeys.has(key))
      let created = 0
      if (toCreate.length > 0) {
        const marketRows: TablesInsert<'bet_markets'>[] = toCreate.map(([, d]) => ({
          market_type: 'prop',
          title: `${nameByPlayer.get(d.playerId) ?? '—'} ${STAT_LABELS[d.stat]} — ${
            d.gameNumber != null ? `Game ${d.gameNumber}` : 'Night'
          }`,
          week_id: weekId,
          game_number: d.gameNumber,
          subject_player_id: d.playerId,
          params: { source: 'lanetalk', stat: d.stat, scope: d.gameNumber != null ? 'game' : 'night' },
          status: 'open',
        }))
        const { data: inserted, error: insertErr } = await betMarkets.insertPropMarkets(marketRows)
        if (insertErr) return { error: insertErr.message }

        const selectionRows: TablesInsert<'bet_selections'>[] = []
        for (const m of (inserted ?? []) as any[]) {
          const stat = m.params?.stat as StatKey
          // Markets are only ever created for subjects in linesByPlayer.
          const line = linesByPlayer.get(m.subject_player_id)![stat]
          selectionRows.push(
            { market_id: m.id, key: 'over', label: 'Over', odds: 2.0, line, sort_order: 0 },
            { market_id: m.id, key: 'under', label: 'Under', odds: 2.0, line, sort_order: 1 },
          )
        }
        const { error: selErr } = await betMarkets.insertSelections(selectionRows)
        if (selErr) return { error: selErr.message }
        created = inserted?.length ?? 0
      }

      return {
        result: {
          created,
          pruned: staleIds.length,
          repriced,
          skipped: desired.size - created,
        },
      }
    } catch (e: any) {
      return { error: e?.message ?? 'Failed to generate stat lines' }
    } finally {
      setGenerating(false)
    }
  }

  return { generating, generateStatLines }
}
