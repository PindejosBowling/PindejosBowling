import { pvpChallenges } from '../utils/supabase/db'
import { normalizeChallenge, PvpChallengeView } from './usePvpData'
import { useAsyncData } from './useAsyncData'

// One offer/counteroffer in the negotiation trail.
export interface PvpOfferView {
  id: string
  offerNo: number
  offeredById: string
  offeredByName: string
  contractType: string
  creatorStake: number
  counterpartyStake: number
  gameNumber: number | null
  selection: string | null
  message: string | null
  createdAt: string
  superseded: boolean
  accepted: boolean
  declined: boolean
}

// One pvp_ledger economic event (stake / payout / refund).
export interface PvpLedgerView {
  id: string
  type: string            // 'stake' | 'payout' | 'refund'
  amount: number          // signed, player-side
  description: string
  createdAt: string
  weekNumber: number | null
}

interface PvpChallengeDetailPayload {
  challenge: PvpChallengeView | null
  offers: PvpOfferView[]
  ledger: PvpLedgerView[]
}

const EMPTY: PvpChallengeDetailPayload = { challenge: null, offers: [], ledger: [] }

export function usePvpChallengeDetail(challengeId: string | null) {
  const { loading, data: payload, reload } = useAsyncData<PvpChallengeDetailPayload>(async () => {
    if (!challengeId) return EMPTY

    const { data } = await pvpChallenges.getById(challengeId)
    if (!data) return EMPTY

    const rawOffers: any[] = (data as any).pvp_challenge_offers ?? []
    const offers = rawOffers
      .slice()
      .sort((a, b) => (a.offer_no ?? 0) - (b.offer_no ?? 0))
      .map((o): PvpOfferView => ({
        id: o.id,
        offerNo: o.offer_no,
        offeredById: o.offered_by_player_id,
        offeredByName: o.offerer?.name ?? '—',
        contractType: o.contract_type,
        creatorStake: o.creator_stake,
        counterpartyStake: o.counterparty_stake,
        gameNumber: o.game_number ?? null,
        selection: o.creator_selection ?? null,
        message: o.message ?? null,
        createdAt: o.created_at,
        superseded: o.superseded_at != null,
        accepted: o.accepted_at != null,
        declined: o.declined_at != null,
      }))

    const rawLedger: any[] = (data as any).pvp_ledger ?? []
    const ledger = rawLedger
      .filter(r => r.player_id != null)   // player-side rows only (skip house mirror)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))   // newest first
      .map((r): PvpLedgerView => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        description: r.description,
        createdAt: r.created_at,
        weekNumber: (r.weeks as any)?.week_number ?? null,
      }))

    return { challenge: normalizeChallenge(data), offers, ledger }
  }, [challengeId], 'usePvpChallengeDetail')

  return { loading, ...(payload ?? EMPTY), reload }
}
