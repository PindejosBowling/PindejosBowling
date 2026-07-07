import { seasons, pinLedger, pvpChallenges } from '../utils/supabase/db'
import { computeBalance } from '../utils/ledger'
import { useAsyncData } from './useAsyncData'

// A flattened pvp_challenges row with resolved participant names. The screen
// derives its display (record, CTA, etc.) via useMemo; no memo in the hook.
export interface PvpChallengeView {
  id: string
  contractType: string
  status: string
  creatorId: string
  creatorName: string
  counterpartyId: string | null
  counterpartyName: string | null
  weekId: string
  gameNumber: number | null
  creatorStake: number
  counterpartyStake: number
  totalPot: number
  payoutAmount: number
  creatorLine: number | null
  counterpartyLine: number | null
  creatorHandicap: number
  counterpartyHandicap: number
  propMarketId: string | null
  creatorSelection: string | null
  counterpartySelection: string | null
  subjectPlayerId: string | null
  winnerId: string | null
  resultDetail: any
  creatorMessage: string | null
  customTitle: string | null
  customDescription: string | null
  adminNote: string | null
  rematchOfId: string | null
  createdAt: string
  // The latest still-live offer's offerer (null when none / resolved). Drives the
  // "whose turn" bucketing on the inbox.
  activeOfferBy: string | null
}

export function normalizeChallenge(c: any): PvpChallengeView {
  // The latest non-superseded, non-resolved offer = the only acceptable one.
  const offers: any[] = c.pvp_challenge_offers ?? []
  const live = offers
    .filter(o => o.superseded_at == null && o.accepted_at == null && o.declined_at == null)
    .sort((a, b) => (b.offer_no ?? 0) - (a.offer_no ?? 0))[0]

  return {
    id: c.id,
    contractType: c.contract_type,
    status: c.status,
    creatorId: c.creator_player_id,
    creatorName: c.creator?.name ?? '—',
    counterpartyId: c.counterparty_player_id ?? null,
    counterpartyName: c.counterparty?.name ?? null,
    weekId: c.week_id,
    gameNumber: c.game_number ?? null,
    creatorStake: c.creator_stake,
    counterpartyStake: c.counterparty_stake,
    totalPot: c.total_pot,
    payoutAmount: c.payout_amount,
    creatorLine: c.creator_line != null ? Number(c.creator_line) : null,
    counterpartyLine: c.counterparty_line != null ? Number(c.counterparty_line) : null,
    creatorHandicap: Number(c.creator_handicap ?? 0),
    counterpartyHandicap: Number(c.counterparty_handicap ?? 0),
    propMarketId: c.prop_market_id ?? null,
    creatorSelection: c.creator_selection ?? null,
    counterpartySelection: c.counterparty_selection ?? null,
    subjectPlayerId: c.subject_player_id ?? null,
    winnerId: c.winner_player_id ?? null,
    resultDetail: c.result_detail ?? {},
    creatorMessage: c.creator_message ?? null,
    customTitle: c.custom_title ?? null,
    customDescription: c.custom_description ?? null,
    adminNote: c.admin_note ?? null,
    rematchOfId: c.rematch_of_challenge_id ?? null,
    createdAt: c.created_at,
    activeOfferBy: live?.offered_by_player_id ?? null,
  }
}

// A contract is "received" (awaiting *this* player's response) when it's
// pending/countered and they didn't make the latest live offer. The single
// source of truth for the inbox `received` bucket and the PvP notification count.
export function isReceivedForPlayer(c: PvpChallengeView, playerId: string): boolean {
  return (
    (c.status === 'pending' || c.status === 'countered') &&
    !(c.activeOfferBy && c.activeOfferBy === playerId)
  )
}

export interface PvpInbox {
  received: PvpChallengeView[]   // pending/countered where it's my turn
  sent: PvpChallengeView[]       // pending/countered I'm waiting on
  active: PvpChallengeView[]     // locked
  settled: PvpChallengeView[]    // settled/pushed/voided/cancelled/expired
}

export interface PvpRecord { wins: number; losses: number; pushes: number }

const EMPTY_INBOX: PvpInbox = { received: [], sent: [], active: [], settled: [] }
const EMPTY_RECORD: PvpRecord = { wins: 0, losses: 0, pushes: 0 }

interface PvpPayload {
  balance: number
  inbox: PvpInbox
  openBoard: PvpChallengeView[]
  // Every settled challenge leaguewide for the displayed season, newest first —
  // a public results feed (the "Challenges Won" board).
  wonBoard: PvpChallengeView[]
  record: PvpRecord
  // True when no season is live and we're showing the most-recently-ended
  // season's frozen state (mirrors the Pinsino between-seasons behavior).
  seasonConcluded: boolean
}

const EMPTY: PvpPayload = {
  balance: 0, inbox: EMPTY_INBOX, openBoard: [], wonBoard: [], record: EMPTY_RECORD, seasonConcluded: false,
}

// One player's PvP state: season balance (for stake validation), the bucketed
// inbox, the open board they can accept, and their challenge record.
export function usePvpData(playerId: string | null, viewSeasonId?: string | null) {
  const { loading, data, reload } = useAsyncData<PvpPayload>(async () => {
    if (!playerId) return EMPTY

    // Past-season mode points at the requested prior season; otherwise falls
    // back to the most-recently-ended season between seasons so results (and
    // the Challenges Won board) stay visible until the next season starts.
    // The pending/open buckets come back empty for a concluded season, leaving
    // the settled inbox + Challenges Won board as the read-only review.
    let seasonId: string | null
    let seasonConcluded: boolean
    if (viewSeasonId) {
      seasonId = (await seasons.getById(viewSeasonId)).data?.id ?? null
      seasonConcluded = true
    } else {
      const seasonRes = await seasons.getCurrentOrLastEnded()
      seasonId = seasonRes.data?.id ?? null
      seasonConcluded = seasonRes.concluded
    }
    if (!seasonId) return { ...EMPTY, seasonConcluded }

    let ledgerData: any[] = []
    let mineData: any[] = []
    let boardData: any[] = []
    let wonData: any[] = []
    await Promise.all([
      pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
      pvpChallenges.listByPlayerSeason(playerId, seasonId).then(({ data }) => { mineData = data ?? [] }),
      pvpChallenges.listOpenBySeason(seasonId).then(({ data }) => { boardData = data ?? [] }),
      pvpChallenges.listWonBySeason(seasonId).then(({ data }) => { wonData = data ?? [] }),
    ])

    const mine = mineData.map(normalizeChallenge)
    const next: PvpInbox = { received: [], sent: [], active: [], settled: [] }
    const rec: PvpRecord = { wins: 0, losses: 0, pushes: 0 }

    for (const c of mine) {
      if (c.status === 'pending' || c.status === 'countered') {
        // It's my turn unless I'm the one who made the latest live offer.
        if (isReceivedForPlayer(c, playerId)) next.received.push(c)
        else next.sent.push(c)
      } else if (c.status === 'locked' || c.status === 'accepted') {
        next.active.push(c)
      } else {
        next.settled.push(c)
        if (c.status === 'settled') {
          if (c.winnerId === playerId) rec.wins += 1
          else if (c.winnerId) rec.losses += 1
        } else if (c.status === 'pushed') {
          rec.pushes += 1
        }
      }
    }

    // Open board: everyone's open contracts except the caller's own.
    const board = boardData.map(normalizeChallenge).filter(c => c.creatorId !== playerId)

    return {
      balance: computeBalance(ledgerData),
      inbox: next,
      openBoard: board,
      wonBoard: wonData.map(normalizeChallenge),
      record: rec,
      seasonConcluded,
    }
  }, [playerId, viewSeasonId], 'usePvpData')

  // True when reviewing a specific prior season (drives read-only UI gating).
  const readOnly = viewSeasonId != null

  return { loading, ...(data ?? EMPTY), readOnly, reload }
}
