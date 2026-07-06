import { bountyPosts, bountyLedger } from '../utils/supabase/db'
import { normalizeBounty, BountyView, BountyHunterView } from './useBountyBoardData'
import { useAsyncData } from './useAsyncData'

// The settled-outcome snapshot (design §21) — present only after settlement.
export interface BountySettlementView {
  id: string
  outcome: 'sponsor_win' | 'hunter_win'
  sponsorEscrow: number       // total_sponsor_bounty = R × max_hunters
  totalHunterStakes: number   // n × H
  totalReward: number         // total_protected_hunter_profit = n × R
  houseSeed: number           // House subsidy (House bounty hunter win); else 0
  totalPot: number            // headline winnings to the winning side
  winnerCount: number
  reasoning: string
  settledAt: string
}

// A winner-specific payout row (design §22). is_house rows carry no player name.
export interface BountyPayoutView {
  id: string
  playerId: string | null
  playerName: string | null
  isHouse: boolean
  amount: number
}

// A bounty-tagged pin_ledger row (sponsor stake / hunter stake / payout).
export interface BountyLedgerView {
  id: string
  type: string
  amount: number
  isHouse: boolean
  playerName: string | null
  description: string
  createdAt: string
}

interface BountyDetailData {
  loading: boolean
  bounty: BountyView | null
  hunters: BountyHunterView[]
  settlement: BountySettlementView | null
  payouts: BountyPayoutView[]
  ledger: BountyLedgerView[]
  reload: () => Promise<void>
}

type BountyDetailPayload = Pick<BountyDetailData, 'bounty' | 'settlement' | 'payouts' | 'ledger'>

const EMPTY: BountyDetailPayload = { bounty: null, settlement: null, payouts: [], ledger: [] }

export function useBountyDetail(bountyId: string | null): BountyDetailData {
  const { loading, data, reload } = useAsyncData<BountyDetailPayload>(async () => {
    if (!bountyId) return EMPTY

    let postRow: any = null
    let ledgerRows: any[] = []
    await Promise.all([
      bountyPosts.getById(bountyId).then(({ data }) => { postRow = data }),
      bountyLedger.listByPost(bountyId).then(({ data }) => { ledgerRows = data ?? [] }),
    ])

    if (!postRow) return EMPTY

    const settleRow = (postRow.bounty_settlements ?? [])[0]
    const payoutRows: any[] = postRow.bounty_payouts ?? []

    return {
      bounty: normalizeBounty(postRow),
      settlement: settleRow ? {
        id: settleRow.id,
        outcome: settleRow.settlement_outcome,
        sponsorEscrow: settleRow.total_sponsor_bounty,
        totalHunterStakes: settleRow.total_hunter_stakes,
        totalReward: settleRow.total_protected_hunter_profit,
        houseSeed: settleRow.total_house_seed,
        totalPot: settleRow.total_pot,
        winnerCount: settleRow.winner_count,
        reasoning: settleRow.admin_settlement_reasoning,
        settledAt: settleRow.settled_at,
      } : null,
      payouts: payoutRows.map((p): BountyPayoutView => ({
        id: p.id,
        playerId: p.player_id ?? null,
        playerName: p.players?.name ?? null,
        isHouse: p.is_house ?? false,
        amount: p.payout_amount,
      })),
      ledger: ledgerRows.map((r): BountyLedgerView => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        isHouse: r.is_house ?? false,
        playerName: r.players?.name ?? null,
        description: r.description,
        createdAt: r.created_at,
      })),
    }
  }, [bountyId], 'useBountyDetail')

  const payload = data ?? EMPTY

  return {
    loading,
    ...payload,
    hunters: payload.bounty?.hunters ?? [],
    reload,
  }
}
