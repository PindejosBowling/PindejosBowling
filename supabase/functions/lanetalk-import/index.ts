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
import { classifyNight, chooseSlot, matchPlayer, type NightGameInput, type OfficialScore, type SlotCandidate, type SlotOfficialScores } from './match.ts'

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

/** Lanetalk's "share" action copies the link wrapped in headline text, e.g.
 *  "JORDAN-PBL bowled 462 at Lucky Strike Times Square http://shared.lanetalk.com/<hash>".
 *  Pull the first shared.lanetalk.com URL out of whatever the admin pasted; fall
 *  back to the raw trimmed input when there's no match, so the existing URL/host
 *  validation still produces a sensible error. */
function extractLanetalkUrl(raw: string): string {
  const m = raw.match(/https?:\/\/shared\.lanetalk\.com\/\S+/i)
  return m ? m[0] : raw.trim()
}

/** One game in a player's combined night (parsed fresh, or read back from a row). */
type NightRow = NightGameInput & { payload: Record<string, unknown> }

/** A lanetalk_game_imports row reshaped for the night classifier — the raw
 *  Lanetalk session position lives in payload.game_number (the column holds the
 *  resolved league/derived number, which is exactly what we're recomputing). */
function rowToNight(r: any): NightRow {
  const pos = Number(r.payload?.game_number ?? 0)
  return {
    key: `${r.source_url}#${pos}`,
    sourceUrl: r.source_url as string,
    sessionPosition: pos,
    score: r.score as number | null,
    playedAt: r.played_at as string | null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }
}

/** Each team-slot's recorded official scores for the week, league-game ordered. */
async function loadSlotScores(
  admin: any, weekId: string, teamSlotIds: string[],
): Promise<{ slots: SlotOfficialScores[]; error?: string }> {
  if (!teamSlotIds.length) return { slots: [] }
  const { data, error } = await admin
    .from('scores')
    .select('score, team_slot_id, games!inner(game_number), team_slots!inner(teams!inner(week_id))')
    .eq('team_slots.teams.week_id', weekId)
    .in('team_slot_id', teamSlotIds)
    .not('score', 'is', null)
  if (error) return { slots: [], error: error.message }
  const bySlot = new Map<string, OfficialScore[]>(teamSlotIds.map(id => [id, []]))
  for (const r of (data ?? []) as any[]) {
    bySlot.get(r.team_slot_id as string)?.push({ gameNumber: r.games.game_number as number, score: r.score as number })
  }
  const slots: SlotOfficialScores[] = teamSlotIds.map(id => ({
    teamSlotId: id,
    officialScores: (bySlot.get(id) ?? []).sort((a, b) => a.gameNumber - b.gameNumber),
  }))
  return { slots }
}

/** Classify a player's whole night and build one insert row per game. The raw
 *  session position is preserved inside payload.game_number; the column carries
 *  the resolved number. */
function buildNightRows(
  nightGames: NightRow[], officialScores: OfficialScore[],
  chosenSlot: SlotOfficialScores | null, playerId: string | null, weekId: string,
) {
  const assignByKey = new Map(classifyNight(nightGames, officialScores).map(a => [a.key, a]))
  return nightGames.map(g => {
    const a = assignByKey.get(g.key)!
    const teamSlotId = a.classification === 'official' && chosenSlot ? chosenSlot.teamSlotId : null
    return {
      source_url: g.sourceUrl,
      game_number: a.gameNumber,
      classification: a.classification,
      player_id: playerId,
      team_slot_id: teamSlotId,
      week_id: weekId,
      score: g.score,
      played_at: g.playedAt,
      payload: { ...g.payload, game_number: g.sessionPosition, classification: a.classification, team_slot_id: teamSlotId, player_id: playerId },
    }
  })
}

/**
 * Re-derive classification + game numbers for every imported game already stored
 * for a week — no link re-fetch. Uses the stored payloads (frames/score/time/raw
 * position are all present), so it fixes matching for a lane-split night the
 * admin can't otherwise clear. Matched players are recomputed per player across
 * all their links (the night model); unmatched links (player_id null) are
 * recomputed per source_url (all recreational). Replaces the week's rows wholesale.
 */
async function reprocessWeek(
  admin: any, weekId: string,
  log: (stage: string, extra?: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const { data: importRows, error: importErr } = await admin
    .from('lanetalk_game_imports')
    .select('source_url, score, played_at, payload, player_id')
    .eq('week_id', weekId)
  if (importErr) return { ok: false, stage: 'reprocess_lookup', message: `Could not load imports: ${importErr.message}` }
  if (!importRows?.length) return { ok: false, stage: 'reprocess_empty', message: 'No imported games for that week' }

  // playerId → that player's non-fill team_slots this week (for official scores).
  const { data: slotRows, error: slotErr } = await admin
    .from('team_slots')
    .select('id, player_id, teams!inner(week_id)')
    .eq('teams.week_id', weekId)
    .not('player_id', 'is', null)
  if (slotErr) return { ok: false, stage: 'reprocess_slots', message: `Slot lookup failed: ${slotErr.message}` }
  const slotsByPlayer = new Map<string, string[]>()
  for (const r of (slotRows ?? []) as any[]) {
    const arr = slotsByPlayer.get(r.player_id as string) ?? []
    arr.push(r.id as string)
    slotsByPlayer.set(r.player_id as string, arr)
  }

  // Group imports: matched players by player_id (combined night), unmatched by
  // source_url (each link is a distinct session — never merge different people).
  const byPlayer = new Map<string, NightRow[]>()
  const byUrl = new Map<string, NightRow[]>()
  for (const r of importRows as any[]) {
    const nr = rowToNight(r)
    if (r.player_id) {
      const arr = byPlayer.get(r.player_id as string) ?? []
      arr.push(nr); byPlayer.set(r.player_id as string, arr)
    } else {
      const arr = byUrl.get(nr.sourceUrl) ?? []
      arr.push(nr); byUrl.set(nr.sourceUrl, arr)
    }
  }

  const outRows: ReturnType<typeof buildNightRows> = []
  let officialCount = 0
  for (const [playerId, games] of byPlayer) {
    const { slots, error } = await loadSlotScores(admin, weekId, slotsByPlayer.get(playerId) ?? [])
    if (error) return { ok: false, stage: 'reprocess_scores', message: `Score lookup failed: ${error}` }
    const chosen = chooseSlot(games, slots)
    const rows = buildNightRows(games, chosen?.officialScores ?? [], chosen, playerId, weekId)
    officialCount += rows.filter(r => r.classification === 'official').length
    outRows.push(...rows)
  }
  for (const [, games] of byUrl) {
    outRows.push(...buildNightRows(games, [], null, null, weekId))
  }

  log('reprocess_derived', { weekId, players: byPlayer.size, unmatchedLinks: byUrl.size, rows: outRows.length, officialCount })

  // Replace the week's imports (rows built fully in memory first; nothing
  // references these by FK). Renumbering across links can't survive the
  // (source_url, game_number) upsert key, so delete-then-insert.
  const { error: delErr } = await admin.from('lanetalk_game_imports').delete().eq('week_id', weekId)
  if (delErr) return { ok: false, stage: 'reprocess_clear', message: `Could not clear imports: ${delErr.message}` }
  const { error: insErr } = await admin.from('lanetalk_game_imports').insert(outRows)
  if (insErr) return { ok: false, stage: 'reprocess_write', message: `Rewrite failed: ${insErr.message}. Re-import the affected links.` }

  return {
    ok: true,
    reprocessed: true,
    weekId,
    players: byPlayer.size,
    rowCount: outRows.length,
    officialCount,
    recreationalCount: outRows.length - officialCount,
  }
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
    let body: any
    try {
      body = await req.json()
    } catch (e) {
      return fail('input_body', 'Invalid request body', 400, errInfo(e))
    }

    // Reprocess mode: re-derive an already-imported week from its stored payloads
    // (no link fetch). Re-matches a lane-split night the admin can't clear.
    const reprocessWeekId = body?.reprocessWeekId ? String(body.reprocessWeekId).trim() : ''
    // Optional admin-pinned target week for a normal import. Safety valve for a
    // night whose date can't be parsed (parse_no_date) or that spans a lane
    // split: bind directly to this week and skip date-based resolution, mirroring
    // how reprocessWeekId is threaded end-to-end.
    const explicitWeekId = body?.weekId ? String(body.weekId).trim() : ''
    if (reprocessWeekId) {
      log('reprocess_start', { weekId: reprocessWeekId })
      const result = await reprocessWeek(admin, reprocessWeekId, log)
      if (!result.ok) console.error(JSON.stringify({ reqId, ...result }))
      return json({ ...result, reqId })
    }

    // Accept a bare link or the share-text headline Lanetalk copies around it.
    let url = extractLanetalkUrl(String(body?.url ?? ''))
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
    // ── Resolve the league week ───────────────────────────────────────────────
    // Explicit admin-pinned week wins: bind directly and skip date resolution
    // (works even when the date couldn't be parsed). Otherwise resolve from the
    // Monday-normalized session date against weeks.bowled_at.
    let weekId: string | null = null
    if (explicitWeekId) {
      const { data: wk, error: wkErr } = await admin
        .from('weeks')
        .select('id')
        .eq('id', explicitWeekId)
        .limit(1)
        .maybeSingle()
      if (wkErr) return fail('week_lookup', `Week lookup failed: ${wkErr.message}`, 500, { weekId: explicitWeekId, error: wkErr.message })
      weekId = wk?.id ?? null
      if (!weekId) {
        return fail('week_not_found', `No league week found for id ${explicitWeekId}`, 200, {
          weekResolved: false, weekId: explicitWeekId, player: session.player,
        })
      }
      log('week_resolved', { weekId, source: 'explicit' })
    } else {
      if (!session.date) {
        return fail('parse_no_date', 'Could not read a date from that session', 200, {
          datetimeText: session.datetime_text, player: session.player,
        })
      }
      const { data: weekRows, error: weekErr } = await admin
        .from('weeks')
        .select('id')
        .eq('bowled_at', session.date)
        .order('week_number', { ascending: false })
        .limit(1)
      if (weekErr) return fail('week_lookup', `Week lookup failed: ${weekErr.message}`, 500, { date: session.date, error: weekErr.message })
      weekId = weekRows?.[0]?.id ?? null
      if (!weekId) {
        return fail('week_not_found', `No league week found for ${session.date}`, 200, {
          weekResolved: false, date: session.date, datetimeText: session.datetime_text, player: session.player,
        })
      }
      log('week_resolved', { weekId, date: session.date, source: 'date' })
    }

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

    // ── Assemble the player's whole league night (every link combined) ────────
    // A lane-switch night is uploaded as several links, each holding only part of
    // the player's official set. Classify/number across the *whole* night, or an
    // official game on a 2nd link gets mis-flagged Recreational and game numbers
    // collide across links. (Unmatched player → can't combine; this link alone.)
    const fresh: NightRow[] = session.games.map(g => ({
      key: `${url}#${g.game_number}`,
      sourceUrl: url,
      sessionPosition: g.game_number,
      score: g.score,
      playedAt: g.played_at,
      payload: g as unknown as Record<string, unknown>,
    }))
    let prior: NightRow[] = []
    if (matched) {
      const { data: priorRows, error: priorErr } = await admin
        .from('lanetalk_game_imports')
        .select('source_url, score, played_at, payload')
        .eq('week_id', weekId)
        .eq('player_id', matched.playerId)
        .neq('source_url', url)
      if (priorErr) return fail('prior_lookup', `Prior-import lookup failed: ${priorErr.message}`, 500, { weekId, playerId: matched.playerId, error: priorErr.message })
      prior = (priorRows ?? []).map(rowToNight)
    }
    const nightGames: NightRow[] = [...prior, ...fresh]
    log('night_assembled', { freshGames: fresh.length, priorGames: prior.length, links: new Set(nightGames.map(g => g.sourceUrl)).size })

    // ── Official scores recorded for the matched player's slot(s) this week ───
    // A player can be slotted on two teams in one week; load each slot's scores,
    // then pick the slot this night belongs to by score overlap (chooseSlot),
    // using the whole night's totals — not just this link's.
    let chosenSlot: SlotOfficialScores | null = null
    if (matched) {
      const { slots, error } = await loadSlotScores(admin, weekId, matched.teamSlotIds)
      if (error) return fail('score_lookup', `Score lookup failed: ${error}`, 500, { weekId, teamSlotIds: matched.teamSlotIds, error })
      chosenSlot = chooseSlot(nightGames, slots)
    }
    const officialScores = chosenSlot?.officialScores ?? []
    if (matched) {
      log('slot_chosen', {
        teamSlotId: chosenSlot?.teamSlotId ?? null,
        candidateSlotCount: matched.teamSlotIds.length,
        officialScores,
      })
    }

    // ── Classify the whole night + build one row per game ─────────────────────
    const rows = buildNightRows(nightGames, officialScores, chosenSlot, matched?.playerId ?? null, weekId)

    // ── Write back ────────────────────────────────────────────────────────────
    // Renumbering across links can't survive an upsert keyed on (source_url,
    // game_number), so replace the affected rows wholesale (nothing references
    // these rows by FK). Matched → the player's whole week (every link recomputed
    // together); unmatched → just this link.
    const clear = matched
      ? admin.from('lanetalk_game_imports').delete().eq('week_id', weekId).eq('player_id', matched.playerId)
      : admin.from('lanetalk_game_imports').delete().eq('source_url', url)
    const { error: delErr } = await clear
    if (delErr) return fail('import_clear', `Could not clear prior imports: ${delErr.message}`, 500, { weekId, url, error: delErr.message })
    const { error: insErr } = await admin.from('lanetalk_game_imports').insert(rows)
    if (insErr) return fail('import_write', `Import write failed: ${insErr.message}`, 500, { rowCount: rows.length, error: insErr.message })

    // ── Response: report just the link the admin imported ─────────────────────
    const importedRows = rows
      .filter(r => r.source_url === url)
      .sort((a, b) => a.game_number - b.game_number)
    const officialCount = importedRows.filter(r => r.classification === 'official').length
    log('done', { weekId, nightRows: rows.length, importedRows: importedRows.length, officialCount, recreationalCount: importedRows.length - officialCount })
    return json({
      ok: true,
      reqId,
      weekResolved: true,
      weekId,
      matchedPlayer: matched?.name ?? null,
      games: importedRows.map(r => ({ gameNumber: r.game_number, score: r.score, classification: r.classification })),
      officialCount,
      recreationalCount: importedRows.length - officialCount,
      debug: {
        sessionPlayer: session.player,
        date: session.date,
        candidateCount: candidates.length,
        officialScores,
        nightLinks: new Set(rows.map(r => r.source_url)).size,
        nightRows: rows.length,
      },
    })
  } catch (e) {
    // Anything unhandled — return a structured 500 instead of an opaque runtime error.
    console.error(JSON.stringify({ reqId, stage: 'unhandled', level: 'fatal', ms: Date.now() - startedAt, ...errInfo(e) }))
    return json({ ok: false, stage: 'unhandled', message: errInfo(e).message, reqId }, 500)
  }
})
