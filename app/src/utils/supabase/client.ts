import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { isReadOnlyNow } from '../readOnlyGate'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_API_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    `Supabase env vars missing. URL: ${supabaseUrl ?? '(undefined)'}, KEY: ${supabaseKey ? '(set)' : '(undefined)'}`,
  )
}

// The only RPCs that read (never mutate). Every other RPC is a write and is
// blocked in read-only mode; these stay allowed so the app still functions.
const READ_ONLY_RPCS = new Set(['is_registered_player', 'my_bid_amount', 'pvp_player_line'])

// Is this a PostgREST request that would write? GET/HEAD are reads. POST to a
// table is an insert; PATCH/PUT/DELETE are updates/upserts/deletes. POST to
// /rpc/<fn> is a write unless <fn> is in the read-only allowlist. (Auth and
// Storage requests use other path prefixes and are never touched.)
function isBlockedRestWrite(method: string, url: string): boolean {
  if (!url.includes('/rest/v1/')) return false
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  const rpc = url.match(/\/rest\/v1\/rpc\/([^?]+)/)
  if (rpc) return !READ_ONLY_RPCS.has(decodeURIComponent(rpc[1]))
  return true
}

// Compliance read-only enforcement, applied to ALL data writes in one place so
// no screen needs per-call-site guards. Blocked writes resolve to a synthetic
// 403 whose message surfaces wherever the caller reads `error.message`.
const guardedFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method =
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  if (isReadOnlyNow() && isBlockedRestWrite(method ?? 'GET', url)) {
    return Promise.resolve(
      new Response(JSON.stringify({ message: 'Login is temporarily unavailable.', code: 'read_only' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  return fetch(input as RequestInfo, init)
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: guardedFetch },
})
