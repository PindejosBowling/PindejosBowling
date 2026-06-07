import { useState, useCallback, useEffect, useRef } from 'react'
import { seasons, pinLedger, bountyPosts } from '../utils/supabase/db'
import { protectedProfit, bountyEconomics } from '../utils/bounty'

// One hunter's entry, flattened. Name is present only when the query embeds it
// (getById / detail); board/inbox queries leave it null.
export interface BountyHunterView {
  id: string
  playerId: string
  playerName: string | null
  stakeAmount: number
  entryNumber: number
  protectedProfit: number
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
  sponsorBountyAmount: number
  hunterStakeAmount: number
  closesAt: string
  status: 'open' | 'closed' | 'settled'
  createdAt: string
  hunters: BountyHunterView[]
  hunterCount: number
  // Preview terms for the *next* hunter (open bounties) — entry order, protected
  // profit, and the running estimated House seed (design §16, §34.4).
  nextEntryNumber: number
  nextProtectedProfit: number
  currentEstimatedSeed: number
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
      protectedProfit: s.protected_hunter_profit,
      status: s.status ?? 'active',
    }))
    .sort((a, b) => a.entryNumber - b.entryNumber)

  const sponsorAmount = row.sponsor_bounty_amount
  const nextEntryNumber = hunters.length + 1

  return {
    id: row.id,
    seasonId: row.season_id,
    weekId: row.week_id ?? null,
    bountyType: row.bounty_type,
    sponsorPlayerId: row.sponsor_player_id ?? null,
    sponsorName: row.sponsor?.name ?? null,
    title: row.title,
    description: row.description,
    sponsorBountyAmount: sponsorAmount,
    hunterStakeAmount: row.hunter_stake_amount,
    closesAt: row.closes_at,
    status: row.status,
    createdAt: row.created_at,
    hunters,
    hunterCount: hunters.length,
    nextEntryNumber,
    nextProtectedProfit: protectedProfit(sponsorAmount, nextEntryNumber),
    currentEstimatedSeed: bountyEconomics(sponsorAmount, hunters).totalHouseSeed,
  }
}

interface BountyBoardData {
  loading: boolean
  balance: number
  openBoard: BountyView[]
  mySponsored: BountyView[]
  myHunted: BountyView[]
  settled: BountyView[]
  reload: () => Promise<void>
}

// One player's Bounty Board state: season balance (stake validation), the open
// board, and the player's involvement bucketed into sponsored / hunted / settled.
export function useBountyBoardData(playerId: string | null): BountyBoardData {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [openBoard, setOpenBoard] = useState<BountyView[]>([])
  const [mySponsored, setMySponsored] = useState<BountyView[]>([])
  const [myHunted, setMyHunted] = useState<BountyView[]>([])
  const [settled, setSettled] = useState<BountyView[]>([])
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true)
    try {
      const reset = () => {
        setBalance(0); setOpenBoard([]); setMySponsored([]); setMyHunted([]); setSettled([])
      }
      if (!playerId) { reset(); return }

      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) { reset(); return }

      let ledgerData: any[] = []
      let boardData: any[] = []
      let mineData: any[] = []
      await Promise.all([
        pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
        bountyPosts.listOpenBySeason(seasonId).then(({ data }) => { boardData = data ?? [] }),
        bountyPosts.listByPlayerSeason(seasonId).then(({ data }) => { mineData = data ?? [] }),
      ])

      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))
      setOpenBoard(boardData.map(normalizeBounty))

      const mine = mineData.map(normalizeBounty)
      const sponsored: BountyView[] = []
      const hunted: BountyView[] = []
      const done: BountyView[] = []
      for (const b of mine) {
        const iSponsor = b.sponsorPlayerId === playerId
        const iHunt = b.hunters.some(h => h.playerId === playerId)
        if (!iSponsor && !iHunt) continue // someone else's bounty — not "mine"
        if (b.status === 'settled') { done.push(b); continue }
        if (iSponsor) sponsored.push(b)
        if (iHunt) hunted.push(b)
      }
      setMySponsored(sponsored)
      setMyHunted(hunted)
      setSettled(done)
    } catch (e) {
      console.error('useBountyBoardData error:', e)
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, openBoard, mySponsored, myHunted, settled, reload: load }
}
