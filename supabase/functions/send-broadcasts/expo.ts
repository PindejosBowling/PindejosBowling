// Expo Push API client — batching for /push/send and /push/getReceipts.
// No SDK: two fetch endpoints with documented batch caps (100 messages,
// 300 receipt ids). Enhanced Push Security is off for this project, so no
// Expo access token is required.

const SEND_URL = 'https://exp.host/--/api/v2/push/send'
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'

export interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
}

/** One entry back from /push/send, index-aligned with the request batch. */
export interface ExpoPushTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

export interface ExpoPushReceipt {
  status: 'ok' | 'error'
  message?: string
  details?: { error?: string }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Expo push API ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

/** Send all messages in ≤100-message batches; returns tickets index-aligned
 *  with the input order (Expo guarantees per-batch ordering). */
export async function sendPushMessages(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = []
  for (const batch of chunk(messages, 100)) {
    const json = await post(SEND_URL, batch)
    tickets.push(...((json?.data ?? []) as ExpoPushTicket[]))
  }
  return tickets
}

/** Fetch receipts in ≤300-id batches; returns a map keyed by receipt id.
 *  A receipt Expo hasn't produced yet is simply absent from the map. */
export async function getPushReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
  const receipts: Record<string, ExpoPushReceipt> = {}
  for (const batch of chunk(ids, 300)) {
    const json = await post(RECEIPTS_URL, { ids: batch })
    Object.assign(receipts, (json?.data ?? {}) as Record<string, ExpoPushReceipt>)
  }
  return receipts
}
