// send-broadcasts — Edge Function (the Push Broadcasts sender).
//
// Two invoke paths, both behind the gateway's verify_jwt:
//   1. Admin send-now (app): { broadcastId } with the admin's user JWT — the
//      row is claimed and sent immediately, no waiting for the cron tick.
//   2. Cron sweep (pg_net):  { sweep: true } with the service-role key as the
//      Bearer token — processes every due pending broadcast AND resolves
//      pending Expo receipts (pruning DeviceNotRegistered tokens).
//
// Claiming is idempotent: status pending→sending in one guarded UPDATE, so a
// send-now invoke racing the next cron tick is harmless (loser sees rowcount
// 0 and skips). A broadcast stuck in 'sending' (function died mid-run) is
// reclaimed after 10 minutes — the pipeline self-heals.
//
// Recipient resolution happens IN the database via broadcast_recipients(),
// the same predicate the admin reach preview uses — opt-out always wins,
// including for targeted sends, and preview/send can never disagree.
//
// Debug reporting mirrors lanetalk-import: every response carries a reqId and
// one structured JSON log line per stage (Dashboard → Functions → logs).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushMessages, getPushReceipts, type ExpoPushMessage } from './expo.ts'

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

function errInfo(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack }
  return { message: String(e) }
}

interface BroadcastRow {
  id: string
  category_id: string
  title: string
  body: string
  target_player_ids: string[] | null
  data: Record<string, unknown>
}

/** Claim + send one broadcast. Returns a summary for the response/logs. */
async function processBroadcast(
  admin: any,
  id: string,
  log: (stage: string, extra?: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  // Idempotent claim: pending & due, or a stale 'sending' row (crashed run).
  const { data: claimed, error: claimErr } = await admin
    .from('broadcasts')
    .update({ status: 'sending', claimed_at: new Date().toISOString() })
    .eq('id', id)
    .lte('scheduled_for', new Date().toISOString())
    .or(`status.eq.pending,and(status.eq.sending,claimed_at.lt.${new Date(Date.now() - 10 * 60_000).toISOString()})`)
    .select('id, category_id, title, body, target_player_ids, data')
    .maybeSingle()
  if (claimErr) throw new Error(`claim failed: ${claimErr.message}`)
  if (!claimed) {
    log('claim_skipped', { broadcastId: id })
    return { broadcastId: id, skipped: true }
  }
  const b = claimed as BroadcastRow

  try {
    // Category key rides into the push payload for future client-side routing.
    const { data: cat } = await admin
      .from('broadcast_categories').select('key').eq('id', b.category_id).single()

    // The one recipient-resolution path (opt-out always wins).
    const { data: recipients, error: recErr } = await admin.rpc('broadcast_recipients', {
      p_category_id: b.category_id,
      p_target_player_ids: b.target_player_ids,
    })
    if (recErr) throw new Error(`recipient resolution failed: ${recErr.message}`)
    const recips = (recipients ?? []) as { player_id: string; expo_push_token: string }[]
    log('recipients_resolved', { broadcastId: b.id, count: recips.length })

    if (recips.length === 0) {
      // A valid no-op (everyone opted out / no tokens yet), not a failure.
      await admin.from('broadcasts').update({
        status: 'sent', sent_at: new Date().toISOString(),
        recipient_count: 0, delivered_count: 0, failed_count: 0,
      }).eq('id', b.id)
      return { broadcastId: b.id, recipients: 0, delivered: 0, failed: 0 }
    }

    // Token id lookup for the ticket rows (service role bypasses RLS).
    const { data: tokenRows, error: tokErr } = await admin
      .from('push_tokens').select('id, expo_push_token')
      .in('expo_push_token', recips.map(r => r.expo_push_token))
    if (tokErr) throw new Error(`token lookup failed: ${tokErr.message}`)
    const tokenIdByToken = new Map(
      ((tokenRows ?? []) as { id: string; expo_push_token: string }[])
        .map(t => [t.expo_push_token, t.id]),
    )

    const messages: ExpoPushMessage[] = recips.map(r => ({
      to: r.expo_push_token,
      title: b.title,
      body: b.body,
      sound: 'default',
      data: { ...b.data, broadcastId: b.id, categoryKey: cat?.key ?? null },
    }))

    const tickets = await sendPushMessages(messages)
    log('expo_sent', { broadcastId: b.id, messages: messages.length, tickets: tickets.length })

    // Record tickets; prune tokens Expo rejects immediately.
    const ticketRows: Record<string, unknown>[] = []
    const deadTokens: string[] = []
    let delivered = 0
    tickets.forEach((t, i) => {
      const token = messages[i].to
      const ok = t.status === 'ok'
      if (ok) delivered++
      const code = t.details?.error ?? null
      if (!ok && code === 'DeviceNotRegistered') deadTokens.push(token)
      ticketRows.push({
        broadcast_id: b.id,
        push_token_id: tokenIdByToken.get(token) ?? null,
        ticket_id: ok ? (t.id ?? null) : null,
        status: ok ? 'pending_receipt' : 'error',
        error_code: ok ? null : (code ?? t.message ?? 'send_error'),
      })
    })
    const { error: tickErr } = await admin.from('broadcast_push_tickets').insert(ticketRows)
    if (tickErr) log('ticket_write_failed', { broadcastId: b.id, error: tickErr.message })
    if (deadTokens.length) {
      await admin.from('push_tokens').delete().in('expo_push_token', deadTokens)
      log('tokens_pruned_at_send', { broadcastId: b.id, count: deadTokens.length })
    }

    await admin.from('broadcasts').update({
      status: 'sent', sent_at: new Date().toISOString(),
      recipient_count: recips.length,
      delivered_count: delivered,
      failed_count: tickets.length - delivered,
    }).eq('id', b.id)

    return { broadcastId: b.id, recipients: recips.length, delivered, failed: tickets.length - delivered }
  } catch (e) {
    // Per-broadcast isolation (mirrors sweep_auctions): mark failed, rethrow
    // nothing — the sweep moves on to the next due row.
    const msg = errInfo(e).message as string
    await admin.from('broadcasts')
      .update({ status: 'failed', error: msg.slice(0, 1000) })
      .eq('id', b.id)
    log('broadcast_failed', { broadcastId: b.id, error: msg })
    return { broadcastId: b.id, failedWith: msg }
  }
}

/** Resolve pending Expo receipts (≥15 min old) and prune dead tokens. */
async function processReceipts(
  admin: any,
  log: (stage: string, extra?: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: pending, error } = await admin
    .from('broadcast_push_tickets')
    .select('id, ticket_id, push_token_id')
    .eq('status', 'pending_receipt')
    .not('ticket_id', 'is', null)
    .lt('created_at', cutoff)
    .limit(600)
  if (error) throw new Error(`receipt lookup failed: ${error.message}`)
  const rows = (pending ?? []) as { id: string; ticket_id: string; push_token_id: string | null }[]
  if (!rows.length) return { receiptsChecked: 0 }

  const receipts = await getPushReceipts(rows.map(r => r.ticket_id))
  let okCount = 0, errCount = 0
  const deadTokenIds: string[] = []
  for (const row of rows) {
    const r = receipts[row.ticket_id]
    if (!r) continue // Expo hasn't produced it yet — next sweep retries.
    if (r.status === 'ok') {
      okCount++
      await admin.from('broadcast_push_tickets').update({ status: 'ok' }).eq('id', row.id)
    } else {
      errCount++
      const code = r.details?.error ?? r.message ?? 'receipt_error'
      await admin.from('broadcast_push_tickets')
        .update({ status: 'error', error_code: String(code).slice(0, 200) }).eq('id', row.id)
      if (r.details?.error === 'DeviceNotRegistered' && row.push_token_id) {
        deadTokenIds.push(row.push_token_id)
      }
    }
  }
  if (deadTokenIds.length) {
    await admin.from('push_tokens').delete().in('id', deadTokenIds)
  }
  log('receipts_resolved', { checked: rows.length, ok: okCount, error: errCount, tokensPruned: deadTokenIds.length })
  return { receiptsChecked: rows.length, ok: okCount, error: errCount, tokensPruned: deadTokenIds.length }
}

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID()
  const startedAt = Date.now()

  const log = (stage: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ reqId, stage, ms: Date.now() - startedAt, ...extra }))

  const fail = (stage: string, message: string, status = 200, debug: Record<string, unknown> = {}) => {
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
      return fail('config', 'Function is missing required environment secrets', 500, {
        hasUrl: !!SUPABASE_URL, hasAnonKey: !!ANON_KEY, hasServiceRoleKey: !!SERVICE_ROLE_KEY,
      })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const authHeader = req.headers.get('Authorization') ?? ''

    let body: any
    try {
      body = await req.json()
    } catch (e) {
      return fail('input_body', 'Invalid request body', 400, errInfo(e))
    }

    // ── Auth: cron path (service-role bearer) or admin user JWT ─────────────
    const isServiceCaller = authHeader === `Bearer ${SERVICE_ROLE_KEY}`
    if (!isServiceCaller) {
      // Same gate as lanetalk-import: the JWT hook puts role in token claims
      // but NOT auth.users.raw_app_meta_data, so validate the token via
      // getUser() then read players.role with the service role.
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
        return fail('auth_not_admin', 'Admins only', 403, { userId: user.id, role: me?.role ?? null })
      }
      log('authed_admin', { userId: user.id, playerId: me.id })
    } else {
      log('authed_sweep')
    }

    // ── Send-now: one broadcast by id ────────────────────────────────────────
    const broadcastId = body?.broadcastId ? String(body.broadcastId).trim() : ''
    if (broadcastId) {
      const result = await processBroadcast(admin, broadcastId, log)
      log('done', result)
      return json({ ok: !result.failedWith, ...result, reqId })
    }

    // ── Sweep: every due pending broadcast + stale reclaims + receipts ──────
    if (body?.sweep === true) {
      const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString()
      const { data: due, error: dueErr } = await admin
        .from('broadcasts')
        .select('id')
        .or(`and(status.eq.pending,scheduled_for.lte.${new Date().toISOString()}),and(status.eq.sending,claimed_at.lt.${staleCutoff})`)
        .order('scheduled_for')
        .limit(50)
      if (dueErr) return fail('sweep_lookup', `Due lookup failed: ${dueErr.message}`, 500)

      const results: Record<string, unknown>[] = []
      for (const row of (due ?? []) as { id: string }[]) {
        results.push(await processBroadcast(admin, row.id, log))
      }
      const receipts = await processReceipts(admin, log)
      log('done', { swept: results.length, ...receipts })
      return json({ ok: true, swept: results, receipts, reqId })
    }

    return fail('input_mode', 'Pass { broadcastId } or { sweep: true }', 400)
  } catch (e) {
    console.error(JSON.stringify({ reqId, stage: 'unhandled', level: 'fatal', ms: Date.now() - startedAt, ...errInfo(e) }))
    return json({ ok: false, stage: 'unhandled', message: errInfo(e).message, reqId }, 500)
  }
})
