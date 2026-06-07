import { useState, useCallback, useEffect } from 'react'
import { seasons, pinLedger, pvpChallenges } from '../utils/supabase/db'

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

export interface PvpInbox {
  received: PvpChallengeView[]   // pending/countered where it's my turn
  sent: PvpChallengeView[]       // pending/countered I'm waiting on
  active: PvpChallengeView[]     // locked
  settled: PvpChallengeView[]    // settled/pushed/voided/cancelled/expired
}

export interface PvpRecord { wins: number; losses: number; pushes: number }

const EMPTY_INBOX: PvpInbox = { received: [], sent: [], active: [], settled: [] }
const EMPTY_RECORD: PvpRecord = { wins: 0, losses: 0, pushes: 0 }

// One player's PvP state: season balance (for stake validation), the bucketed
// inbox, the open board they can accept, and their challenge record.
export function usePvpData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [inbox, setInbox] = useState<PvpInbox>(EMPTY_INBOX)
  const [openBoard, setOpenBoard] = useState<PvpChallengeView[]>([])
  const [record, setRecord] = useState<PvpRecord>(EMPTY_RECORD)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!playerId) {
        setBalance(0); setInbox(EMPTY_INBOX); setOpenBoard([]); setRecord(EMPTY_RECORD)
        return
      }

      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) {
        setBalance(0); setInbox(EMPTY_INBOX); setOpenBoard([]); setRecord(EMPTY_RECORD)
        return
      }

      let ledgerData: any[] = []
      let mineData: any[] = []
      let boardData: any[] = []
      await Promise.all([
        pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
        pvpChallenges.listByPlayerSeason(playerId, seasonId).then(({ data }) => { mineData = data ?? [] }),
        pvpChallenges.listOpenBySeason(seasonId).then(({ data }) => { boardData = data ?? [] }),
      ])

      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))

      const mine = mineData.map(normalizeChallenge)
      const next: PvpInbox = { received: [], sent: [], active: [], settled: [] }
      const rec: PvpRecord = { wins: 0, losses: 0, pushes: 0 }

      for (const c of mine) {
        if (c.status === 'pending' || c.status === 'countered') {
          // It's my turn unless I'm the one who made the latest live offer.
          if (c.activeOfferBy && c.activeOfferBy === playerId) next.sent.push(c)
          else next.received.push(c)
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

      setInbox(next)
      setOpenBoard(board)
      setRecord(rec)
    } catch (e) {
      console.error('usePvpData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, inbox, openBoard, record, reload: load }
}
