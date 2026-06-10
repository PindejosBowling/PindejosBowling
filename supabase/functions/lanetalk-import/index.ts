// lanetalk-import — Edge Function (first in this repo).
//
// Admin-only. Given a Lanetalk "shared session" URL it: fetches the HTML
// server-side (no iOS ATS / web CORS to worry about), parses it to structured
// games, resolves the league week from the session date, fuzzy-matches the
// bowler to a slotted (non-fill) player for that week, classifies each game
// Official (its total matches one of the player's recorded official scores) or
// Recreational, and upserts one row per game into public.lanetalk_game_imports
// via the service role (one row per game; the per-game payload is jsonb).
//
// Returns 200 with { ok: false, message } for recoverable cases (no week, etc.)
// so the app can surface a toast; 403 for non-admins; 4xx/5xx otherwise.
//
// Debug reporting: every response carries a `reqId` and (on failure) a `stage`
// plus a `debug` object; the same is emitted as one structured JSON log line
// per request stage (view in Dashboard → Functions → lanetalk-import → Logs, or
// `supabase functions logs lanetalk-import`). Grep logs by `reqId` to trace a
// single request end-to-end. This function is admin-only, so returning rich
// diagnostics to the caller is acceptable.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseLanetalk } from './parseLanetalk.ts'
import { classifyGames, chooseSlot, matchPlayer, type SlotCandidate, type SlotOfficialScores } from './match.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

/** Normalize any thrown value into a serializable shape (name/message/stack). */
function errInfo(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack }
  return { message: String(e) }
}

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID()
  const startedAt = Date.now()

  /** One structured log line per stage; grep the logs by reqId to trace a request. */
  const log = (stage: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ reqId, stage, ms: Date.now() - startedAt, ...extra }))

  /** Log an error stage and return it to the (admin) caller with a `stage` + `debug`. */
  const fail = (
    stage: string,
    message: string,
    status = 200,
    debug: Record<string, unknown> = {},
  ) => {
    console.error(JSON.stringify({ reqId, stage, level: 'error', ms: Date.now() - startedAt, message, ...debug }))
    return json({ ok: false, stage, message, reqId, debug }, status)
  }

  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return fail('method', 'Method not allowed', 405, { method: req.method })

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      // Misconfigured deployment — name which secrets are missing (never their values).
      return fail('config', 'Function is missing required environment secrets', 500, {
        hasUrl: !!SUPABASE_URL, hasAnonKey: !!ANON_KEY, hasServiceRoleKey: !!SERVICE_ROLE_KEY,
      })
    }

    log('start', { ua: req.headers.get('user-agent'), clientInfo: req.headers.get('x-client-info') })

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // ── Auth gate: caller must be an admin ────────────────────────────────────
    // The admin role lives on players.role (the source of truth); the JWT hook
    // injects it into the token claims but NOT into auth.users.raw_app_meta_data,
    // so getUser().app_metadata.role is always undefined. Validate the token via
    // getUser(), then read the role from players with the service-role client.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      return fail('auth_token', 'Admins only', 403, { hasAuthHeader: !!authHeader, authError: userErr?.message ?? null })
    }
    const { data: me, error: roleErr } = await admin
      .from('players').select('id, role').eq('user_id', user.id).maybeSingle()
    if (roleErr) return fail('auth_role_lookup', 'Could not verify your role', 500, { userId: user.id, error: roleErr.message })
    if (me?.role !== 'admin') {
      return fail('auth_not_admin', 'Admins only', 403, { userId: user.id, playerId: me?.id ?? null, role: me?.role ?? null })
    }
    log('authed', { userId: user.id, playerId: me.id })

    // ── Input ─────────────────────────────────────────────────────────────────
    let url: string
    try {
      const body = await req.json()
      url = String(body?.url ?? '').trim()
    } catch (e) {
      return fail('input_body', 'Invalid request body', 400, errInfo(e))
    }
    if (!url) return fail('input_empty', 'A Lanetalk link is required', 400)

    // Lanetalk shares are served from a plain S3 website bucket on http only —
    // there is no TLS listener, so an https:// link (how links often get pasted /
    // auto-linkified) fails with a connection reset or a non-2xx S3 response.
    // Pin the host to lanetalk (also an SSRF allowlist) and force the scheme to
    // http so either scheme the user supplies works.
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return fail('input_url', 'That does not look like a valid link', 200, { inputUrl: url })
    }
    if (parsedUrl.hostname !== 'shared.lanetalk.com') {
      return fail('input_host', 'Only shared.lanetalk.com links are supported', 200, { hostname: parsedUrl.hostname })
    }
    const originalScheme = parsedUrl.protocol
    parsedUrl.protocol = 'http:'
    url = parsedUrl.toString()
    log('url_normalized', { url, originalScheme })

    // ── Fetch ──────────────────────────────────────────────────────────────────
    let html: string
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    } catch (e) {
      // Network-level failure (DNS, connection reset, TLS) — no HTTP status.
      return fail('fetch_network', `Could not reach Lanetalk: ${errInfo(e).message}`, 200, { url, error: errInfo(e) })
    }
    if (!res.ok) {
      // Got an HTTP response but a non-2xx status — capture enough to diagnose.
      const bodySnippet = (await res.text().catch(() => '')).slice(0, 500)
      return fail('fetch_status', `Lanetalk fetch failed (${res.status})`, 200, {
        url,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get('content-type'),
        server: res.headers.get('server'),
        bodySnippet,
      })
    }
    html = await res.text()
    log('fetched', { url, status: res.status, htmlBytes: html.length, contentType: res.headers.get('content-type') })

    // ── Parse ────────────────────────────────────────────────────────────────
    const session = parseLanetalk(html, url)
    log('parsed', {
      player: session.player,
      datetimeText: session.datetime_text,
      playedAt: session.played_at,
      date: session.date,
      games: session.games.length,
      summary: session.summary,
    })
    if (!session.games.length) {
      // Parsed HTML but found no games — likely a layout change or a non-session page.
      return fail('parse_no_games', 'No games found at that link', 200, {
        htmlBytes: html.length, player: session.player, title: session.title, datetimeText: session.datetime_text,
      })
    }
    if (!session.date) {
      return fail('parse_no_date', 'Could not read a date from that session', 200, {
        datetimeText: session.datetime_text, player: session.player,
      })
    }

    // ── Resolve the league week from the (Monday-normalized) session date ──────
    const { data: weekRows, error: weekErr } = await admin
      .from('weeks')
      .select('id')
      .eq('bowled_at', session.date)
      .order('week_number', { ascending: false })
      .limit(1)
    if (weekErr) return fail('week_lookup', `Week lookup failed: ${weekErr.message}`, 500, { date: session.date, error: weekErr.message })
    const weekId: string | null = weekRows?.[0]?.id ?? null
    if (!weekId) {
      return fail('week_not_found', `No league week found for ${session.date}`, 200, {
        weekResolved: false, date: session.date, datetimeText: session.datetime_text, player: session.player,
      })
    }
    log('week_resolved', { weekId, date: session.date })

    // ── Candidate set: non-fill team_slots in that week ───────────────────────
    const { data: slotRows, error: slotErr } = await admin
      .from('team_slots')
      .select('id, player_id, players(name), teams!inner(week_id)')
      .eq('teams.week_id', weekId)
      .not('player_id', 'is', null)
    if (slotErr) return fail('slot_lookup', `Slot lookup failed: ${slotErr.message}`, 500, { weekId, error: slotErr.message })

    const candidates: SlotCandidate[] = (slotRows ?? [])
      .map((r: any) => ({
        playerId: r.player_id as string,
        teamSlotId: r.id as string,
        name: (r.players?.name ?? '') as string,
      }))
      .filter(c => c.name)

    const matched = matchPlayer(session.player, candidates)
    log('matched', {
      sessionPlayer: session.player,
      candidateCount: candidates.length,
      matchedPlayer: matched?.name ?? null,
      matchedPlayerId: matched?.playerId ?? null,
      matchedSlotCount: matched?.teamSlotIds.length ?? 0,
    })

    // ── Official scores recorded for the matched player's slot(s) this week ───
    // A player can be slotted on two teams in one week; load each slot's scores,
    // then pick the slot this session belongs to by score overlap (chooseSlot).
    let chosenSlot: SlotOfficialScores | null = null
    if (matched) {
      const { data: scoreRows, error: scoreErr } = await admin
        .from('scores')
        .select('score, team_slot_id, team_slots!inner(teams!inner(week_id))')
        .eq('team_slots.teams.week_id', weekId)
        .in('team_slot_id', matched.teamSlotIds)
        .not('score', 'is', null)
      if (scoreErr) return fail('score_lookup', `Score lookup failed: ${scoreErr.message}`, 500, { weekId, teamSlotIds: matched.teamSlotIds, error: scoreErr.message })
      const bySlot = new Map<string, number[]>(matched.teamSlotIds.map(id => [id, []]))
      for (const r of (scoreRows ?? []) as any[]) {
        bySlot.get(r.team_slot_id as string)?.push(r.score as number)
      }
      const slots: SlotOfficialScores[] = matched.teamSlotIds.map(id => ({
        teamSlotId: id,
        officialScores: bySlot.get(id) ?? [],
      }))
      chosenSlot = chooseSlot(session.games, slots)
    }
    const officialScores = chosenSlot?.officialScores ?? []
    if (matched) {
      log('slot_chosen', {
        teamSlotId: chosenSlot?.teamSlotId ?? null,
        candidateSlotCount: matched.teamSlotIds.length,
        officialScores,
      })
    }

    // ── Classify + build one row per game ─────────────────────────────────────
    const classified = classifyGames(session.games, officialScores)
    const rows = classified.map(({ game, classification }) => {
      const teamSlotId = classification === 'official' && chosenSlot ? chosenSlot.teamSlotId : null
      return {
        source_url: url,
        game_number: game.game_number,
        classification,
        player_id: matched?.playerId ?? null,
        team_slot_id: teamSlotId,
        week_id: weekId,
        score: game.score,
        played_at: game.played_at,
        payload: { ...game, classification, team_slot_id: teamSlotId, player_id: matched?.playerId ?? null },
      }
    })

    const { error: upsertErr } = await admin
      .from('lanetalk_game_imports')
      .upsert(rows, { onConflict: 'source_url,game_number' })
    if (upsertErr) return fail('import_write', `Import write failed: ${upsertErr.message}`, 500, { rowCount: rows.length, error: upsertErr.message })

    const officialCount = classified.filter(c => c.classification === 'official').length
    log('done', { weekId, rowCount: rows.length, officialCount, recreationalCount: classified.length - officialCount })
    return json({
      ok: true,
      reqId,
      weekResolved: true,
      weekId,
      matchedPlayer: matched?.name ?? null,
      games: classified.map(({ game, classification }) => ({
        gameNumber: game.game_number,
        score: game.score,
        classification,
      })),
      officialCount,
      recreationalCount: classified.length - officialCount,
      debug: {
        sessionPlayer: session.player,
        date: session.date,
        candidateCount: candidates.length,
        officialScores,
      },
    })
  } catch (e) {
    // Anything unhandled — return a structured 500 instead of an opaque runtime error.
    console.error(JSON.stringify({ reqId, stage: 'unhandled', level: 'fatal', ms: Date.now() - startedAt, ...errInfo(e) }))
    return json({ ok: false, stage: 'unhandled', message: errInfo(e).message, reqId }, 500)
  }
})
