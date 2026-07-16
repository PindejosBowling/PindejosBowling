import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRoute, useFocusEffect, RouteProp } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import AuctionBidSheet from '../components/auction/AuctionBidSheet'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import { EXPLAINERS } from '../data/pinsinoExplainers'
import { useAuctionDetailData } from '../hooks/useAuctionDetailData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useEconomyRefresh } from '../hooks/useEconomyRefresh'
import { useAuthStore } from '../stores/authStore'
import { formatCountdown } from '../utils/auction'
import { formatCloseTime } from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

type Route = RouteProp<PinsinoStackParamList, 'AuctionDetail'>

export default function AuctionDetailScreen() {
  const { params } = useRoute<Route>()
  const playerId = useAuthStore(s => s.playerId)

  // Admin management lives on AuctionHouseAdmin (Pinsino Admin → Auction House).
  const { readOnly } = usePinsinoSeasonContext()
  const { loading, balance, auction, reload } = useAuctionDetailData(params.auctionId, playerId)

  const [bidOpen, setBidOpen] = useState(false)
  const [bidRevealed, setBidRevealed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Ticking clock for the live countdown (detail screen only; cards are static).
  const [now, setNow] = useState(() => new Date())

  // Placing a bid changes the auction badge count (open auctions with no bid),
  // so reloads here refresh the Pinsino badges too.
  const reloadAll = useEconomyRefresh(reload)
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

  const ticking = auction != null && (auction.status === 'open' || auction.status === 'scheduled')
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [ticking])

  // Non-standard loading (plain + delayed) — kept outside ScreenContainer.
  if (loading) return <LoadingView label="Loading…" delayed />
  if (!auction) {
    return (
      <ScreenContainer title="Auction">
        <View style={styles.emptyCard}><Text style={styles.muted}>This auction no longer exists.</Text></View>
      </ScreenContainer>
    )
  }

  const a = auction
  const open = a.status === 'open'
  const scheduled = a.status === 'scheduled'
  const settled = a.status === 'settled' || a.status === 'settled_no_winner'
  const countdown = open ? formatCountdown(a.closesAt, now) : scheduled ? formatCountdown(a.opensAt, now) : null
  // Past closes_at but the sweep hasn't settled yet: cron lag as theater.
  const hammerFalling = open && countdown == null

  return (
    <ScreenContainer title="Auction" subtitle={a.itemName} onRefresh={reloadAll} onHelp={() => setHelpOpen(true)}>
        {/* Item header */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.itemTitle}>{a.itemIcon} {a.itemName}</Text>
            <Text style={[styles.status, open && styles.statusOpen]}>
              {a.status === 'settled_no_winner' ? 'NO SALE' : a.status.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.effectLine}>{a.itemEffectLine}</Text>
          {/* New auctions derive description from the catalog copy above —
              render it only when distinct (legacy hand-written pitches). */}
          {a.description !== a.itemEffectLine && (
            <Text style={styles.description}>{a.description}</Text>
          )}
        </View>

        {/* Live countdown / hammer — open auctions pair the clock with the
            bidder count at equal prominence; the hard facts ride along below.
            The prose rules live behind the screen's ? explainer. */}
        {(open || scheduled) && (
          <View style={styles.countdownCard}>
            {hammerFalling ? (
              <>
                <Text style={styles.hammer}>🔨 HAMMER FALLING…</Text>
                <Text style={styles.bidderLine}>
                  {a.bidderCount === 0
                    ? 'No sealed bids yet'
                    : `${a.bidderCount} sealed bid${a.bidderCount === 1 ? '' : 's'} in`}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.countdownRow}>
                  <View style={styles.countdownCell}>
                    <Text style={styles.countdownLabel}>{open ? 'CLOSES IN' : 'OPENS IN'}</Text>
                    <Text style={styles.countdownValue}>{countdown}</Text>
                  </View>
                  {open && (
                    <View style={styles.countdownCell}>
                      <Text style={styles.countdownLabel}>{a.bidderCount === 1 ? 'BIDDER' : 'BIDDERS'}</Text>
                      <Text style={styles.countdownValue}>{a.bidderCount}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.factsDivider} />
                <Text style={styles.factsLine}>
                  Min bid {formatPins(a.minimumBid)} pins
                  {a.quantity > 1 ? ` · ${a.quantity} up for grabs` : ''}
                  {' · '}
                  {open ? `Closes ${formatCloseTime(a.closesAt)}` : `Opens ${formatCloseTime(a.opensAt)}`}
                </Text>
              </>
            )}
          </View>
        )}

        {/* My bid (owner-only; RLS means others never receive this row). */}
        {open && a.myBidAmount != null && (
          <>
            <Text style={styles.sectionLabel}>YOUR SEALED BID</Text>
            <TouchableOpacity style={styles.card} onPress={() => setBidRevealed(r => !r)} activeOpacity={0.8}>
              <View style={styles.kv}>
                <Text style={styles.muted}>{bidRevealed ? 'Your pledge' : 'Tap to reveal'}</Text>
                <Text style={styles.kvValue}>{bidRevealed ? `${formatPins(a.myBidAmount)} pins` : '•••'}</Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* Settlement result */}
        {settled && (
          <>
            <Text style={styles.sectionLabel}>THE HAMMER FELL</Text>
            <View style={styles.card}>
              {a.status === 'settled' ? (
                a.winners.length > 0 ? (
                  // Every winner, pay-as-bid (ledger-derived). Falls back to
                  // the denorm row below when the ledger fetch raced.
                  a.winners.map((w, i) => (
                    <View key={i} style={styles.kv}>
                      <Text style={styles.muted}>Won by {w.playerName}</Text>
                      <Text style={styles.kvValue}>{formatPins(w.price)} pins</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.kv}>
                    <Text style={styles.muted}>Won by {a.winnerName}</Text>
                    <Text style={styles.kvValue}>{formatPins(a.winningPrice ?? 0)} pins</Text>
                  </View>
                )
              ) : (
                <Text style={styles.muted}>No sale — no valid bids met the minimum.</Text>
              )}
              {a.status === 'settled' && a.quantity > 1 && a.winners.length < a.quantity && (
                <Text style={styles.muted}>
                  {a.quantity - a.winners.length} of {a.quantity} units went unsold.
                </Text>
              )}
              {a.bounces.map((b, i) => (
                <View key={i} style={styles.kv}>
                  <Text style={styles.muted}>💸 {b.playerName}'s check bounced</Text>
                  <Text style={styles.kvValue}>-{formatPins(b.feePaid)} pins</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Actions — hidden in past-season review. */}
        {open && !hammerFalling && !readOnly && (
          <>
            <Button
              label={a.myBidAmount != null ? 'Edit Bid' : 'Place Sealed Bid'}
              size="lg"
              onPress={() => setBidOpen(true)}
              style={styles.cta}
            />
          </>
        )}

        {/* Modal-based sheet: renders in the native overlay layer, so mounting
            inside the ScrollView children is visually identical. */}
        {bidOpen && (
          <AuctionBidSheet auction={a} balance={balance} onClose={() => setBidOpen(false)} onDone={reloadAll} />
        )}
        {helpOpen && (
          <FeatureExplainerSheet
            explainer={EXPLAINERS.auctionHouse}
            onClose={() => setHelpOpen(false)}
          />
        )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemTitle: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 20, color: colors.text, letterSpacing: 0.3, marginRight: 8 },
  status: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  statusOpen: { color: colors.success },
  effectLine: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text, marginTop: 6, lineHeight: 18 },
  description: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 18 },

  countdownCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  countdownRow: { flexDirection: 'row', alignSelf: 'stretch' },
  countdownCell: { flex: 1, alignItems: 'center' },
  countdownLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted },
  countdownValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 34, color: colors.accent, marginTop: 2 },
  hammer: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 22, color: colors.gold, letterSpacing: 1 },
  bidderLine: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
  factsDivider: { alignSelf: 'stretch', height: 1, backgroundColor: colors.border, marginTop: 12, marginBottom: 10, marginHorizontal: 14 },
  factsLine: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, textAlign: 'center', paddingHorizontal: 14 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, flex: 1, marginRight: 8 },

  cta: { marginTop: 6 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    // Horizontal inset now comes from the ScreenContainer content padding.
    marginTop: 16,
    alignItems: 'center',
  },
})
