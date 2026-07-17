import { useState } from 'react'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import BetDetailModal from '../components/betting/BetDetailModal'
import PvpChallengeDetailModal from '../components/pvp/PvpChallengeDetailModal'
import { useAuthStore } from '../stores/authStore'
import { PinsinoStackParamList } from '../navigation/types'
import { FeedEventView } from '../utils/activityFeedTemplates'
import { bets } from '../utils/supabase/db'
import { normalizeBet, BetView } from './usePinsinoData'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

// Shared tap routing for Market Moves feed events, used by MarketMovesScreen
// and the Pinsino hub's mini-feed carousel so tapping an event opens the same
// detail everywhere. Owns the detail-overlay state; the consuming screen must
// render `modals` alongside its content.
export function useFeedEventPress(onChanged: () => void) {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  // The bet behind a tapped Sportsbook event → the shared Bet Details overlay.
  const [detailBet, setDetailBet] = useState<BetView | null>(null)
  // The challenge behind a tapped PvP event → the shared PvP detail overlay.
  const [detailChallengeId, setDetailChallengeId] = useState<string | null>(null)

  // Fetch the bet anchoring a Sportsbook event and open Bet Details. Stake/
  // payout are public in the Sportsbook view, so this surfaces the same
  // breakdown.
  async function openBetDetail(betId: string) {
    const { data, error } = await bets.getById(betId)
    if (error || !data) {
      console.error('useFeedEventPress openBetDetail error:', error)
      return
    }
    setDetailBet(normalizeBet(data))
  }

  // Privacy-aware tap target (design §16.3). Returns undefined for a
  // non-tappable event so a viewer can never reach another player's private
  // detail.
  function onPressFor(event: FeedEventView): (() => void) | undefined {
    // Sportsbook moves → the corresponding bet's Bet Details overlay.
    if (event.sportsbookBetId) {
      const betId = event.sportsbookBetId
      return () => openBetDetail(betId)
    }
    // Loan moves → ONLY the borrower viewing their own row may deep-link to
    // Loan Shark; everyone else gets a non-tappable event (§16.3, §3.5).
    if (event.loanId) {
      if (playerId && event.actorPlayerId === playerId) {
        return () => navigation.navigate('LoanShark')
      }
      return undefined
    }
    // PvP moves → the shared PvP challenge detail (contracts are public).
    if (event.pvpChallengeId) {
      const challengeId = event.pvpChallengeId
      return () => setDetailChallengeId(challengeId)
    }
    // Bounty moves → the public Bounty detail page.
    if (event.bountySourceId) {
      const bountyId = event.bountySourceId
      return () => navigation.navigate('BountyDetail', { bountyId })
    }
    // Auction moves → the public Auction detail page (a reversed auction's
    // feed rows cascade away, so a live id always resolves).
    if (event.auctionSourceId) {
      const auctionId = event.auctionSourceId
      return () => navigation.navigate('AuctionDetail', { auctionId })
    }
    // Weekly House result + system events: no detail in v1.
    return undefined
  }

  const modals = (
    <>
      <BetDetailModal bet={detailBet} onClose={() => setDetailBet(null)} />
      {detailChallengeId && (
        <PvpChallengeDetailModal
          challengeId={detailChallengeId}
          onClose={() => setDetailChallengeId(null)}
          onChanged={onChanged}
        />
      )}
    </>
  )

  return { onPressFor, modals }
}
