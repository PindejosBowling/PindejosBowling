import { seasons, pinLedger, bountyPosts } from '../utils/supabase/db'
import { computeBalance } from '../utils/ledger'
import { useAsyncData } from './useAsyncData'

// One hunter's entry, flattened. Name is present only when the query embeds it
// (getById / detail); board/inbox queries leave it null.
export interface BountyHunterView {
  id: string
  playerId: string
  playerName: string | null
  stakeAmount: number
  entryNumber: number
  status: string
}

// A flattened bounty_post with resolved sponsor name + hunters. The screen derives
// display (next-hunter terms, payout previews) via useMemo; no memo in the hook.
export interface BountyView {
  id: string
  seasonId: string
  weekId: string | null
  bountyType: 'house_bounty' | 'sponsor_bounty'
  sponsorPlayerId: string | null
  sponsorName: string | null
  title: string
  description: string
  rewardPerHunter: number         // R — what each hunter wins (flat, no dilution)
  hunterStakeAmount: number       // H — what each hunter risks
  maxHunters: number              // m — capacity
  closesAt: string
  status: 'open' | 'closed' | 'settled'
  createdAt: string
  hunters: BountyHunterView[]
  hunterCount: number
  slotsRemaining: number          // m − n (0 = full)
  nextEntryNumber: number
}

export function normalizeBounty(row: any): BountyView {
  const stakes: any[] = row.bounty_hunter_stakes ?? []
  const hunters: BountyHunterView[] = stakes
    .map((s): BountyHunterView => ({
      id: s.id,
      playerId: s.player_id,
      playerName: s.players?.name ?? null,
      stakeAmount: s.stake_amount ?? row.hunter_stake_amount,
      entryNumber: s.entry_number,
      status: s.status ?? 'active',
    }))
    .sort((a, b) => a.entryNumber - b.entryNumber)

  const maxHunters = row.max_hunters

  return {
    id: row.id,
    seasonId: row.season_id,
    weekId: row.week_id ?? null,
    bountyType: row.bounty_type,
    sponsorPlayerId: row.sponsor_player_id ?? null,
    sponsorName: row.sponsor?.name ?? null,
    title: row.title,
    description: row.description,
    rewardPerHunter: row.reward_per_hunter,
    hunterStakeAmount: row.hunter_stake_amount,
    maxHunters,
    closesAt: row.closes_at,
    status: row.status,
    createdAt: row.created_at,
    hunters,
    hunterCount: hunters.length,
    slotsRemaining: Math.max(0, maxHunters - hunters.length),
    nextEntryNumber: hunters.length + 1,
  }
}

interface BountyBoardData {
  loading: boolean
  balance: number
  openBoard: BountyView[]
  mySponsored: BountyView[]
  myHunted: BountyView[]
  settled: BountyView[]
  readOnly: boolean
  reload: () => Promise<void>
}

type BountyBoardPayload = Pick<BountyBoardData, 'balance' | 'openBoard' | 'mySponsored' | 'myHunted' | 'settled'>

const EMPTY: BountyBoardPayload = { balance: 0, openBoard: [], mySponsored: [], myHunted: [], settled: [] }

// One player's Bounty Board state: season balance (stake validation), the open
// board, and the player's involvement bucketed into sponsored / hunted / settled.
// In past-season mode (`viewSeasonId` set) the open board is skipped — only the
// concluded season's settled bounties + the player's involvement load, read-only.
export function useBountyBoardData(playerId: string | null, viewSeasonId?: string | null): BountyBoardData {
  const { loading, data, reload } = useAsyncData<BountyBoardPayload>(async () => {
    if (!playerId) return EMPTY

    // Past-season mode points at the requested prior season; the open board is
    // meaningless there (nothing left to hunt), so it's skipped.
    const seasonId = viewSeasonId
      ? (await seasons.getById(viewSeasonId)).data?.id ?? null
      : (await seasons.getCurrent()).data?.id ?? null
    if (!seasonId) return EMPTY

    let ledgerData: any[] = []
    let boardData: any[] = []
    let mineData: any[] = []
    await Promise.all([
      pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
      viewSeasonId
        ? Promise.resolve()
        : bountyPosts.listOpenBySeason(seasonId).then(({ data }) => { boardData = data ?? [] }),
      bountyPosts.listByPlayerSeason(seasonId).then(({ data }) => { mineData = data ?? [] }),
    ])

    const mine = mineData.map(normalizeBounty)
    const mySponsored: BountyView[] = []
    const myHunted: BountyView[] = []
    const settled: BountyView[] = []
    for (const b of mine) {
      const iSponsor = b.sponsorPlayerId === playerId
      const iHunt = b.hunters.some(h => h.playerId === playerId)
      if (!iSponsor && !iHunt) continue // someone else's bounty — not "mine"
      if (b.status === 'settled') { settled.push(b); continue }
      if (iSponsor) mySponsored.push(b)
      if (iHunt) myHunted.push(b)
    }

    return {
      balance: computeBalance(ledgerData),
      openBoard: boardData.map(normalizeBounty),
      mySponsored,
      myHunted,
      settled,
    }
  }, [playerId, viewSeasonId], 'useBountyBoardData')

  // True when reviewing a specific prior season (drives read-only UI gating).
  const readOnly = viewSeasonId != null

  return { loading, ...(data ?? EMPTY), readOnly, reload }
}
