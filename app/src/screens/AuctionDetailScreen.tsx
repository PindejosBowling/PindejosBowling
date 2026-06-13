import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import AuctionBidSheet from '../components/auction/AuctionBidSheet'
import { useAuctionDetailData } from '../hooks/useAuctionDetailData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { formatCountdown } from '../utils/auction'
import { formatCloseTime } from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'

type Route = RouteProp<PinsinoStackParamList, 'AuctionDetail'>

export default function AuctionDetailScreen() {
  const navigation = useNavigation()
  const { params } = useRoute<Route>()
  const playerId = useAuthStore(s => s.playerId)

  // Admin management lives on AuctionHouseAdmin (Pinsino Admin → Auction House).
  const { loading, balance, auction, reload } = useAuctionDetailData(params.auctionId, playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [bidOpen, setBidOpen] = useState(false)
  const [bidRevealed, setBidRevealed] = useState(false)
  // Ticking clock for the live countdown (detail screen only; cards are static).
  const [now, setNow] = useState(() => new Date())

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const ticking = auction != null && (auction.status === 'open' || auction.status === 'scheduled')
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [ticking])

  if (loading) return <LoadingView label="Loading…" delayed />
  if (!auction) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Auction" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.muted}>This auction no longer exists.</Text></View>
      </SafeAreaView>
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Auction" subtitle={a.itemName} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
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
            bidder count at equal prominence. */}
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
            )}
          </View>
        )}

        {/* Terms — plain language; the numbers live in the kv rows below. */}
        <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
        <View style={styles.card}>
          {[
            a.quantity > 1
              ? `${a.quantity} up for grabs — the top ${a.quantity} bids each take one. You can only win one.`
              : 'One winner — the highest bid takes it.',
            'Bids are secret. Nobody sees your number — only how many bids are in.',
            `Once you're in, you're in. Change your bid any time before the hammer falls — but you can't take it back.`,
            `Win but can't cover your bid? Your check bounces and you're fined up to ${a.bounceFee} pins.`,
          ].map((line, i) => (
            // Hanging indent: wrapped lines align with the text, not the bullet.
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.ruleBullet}>🎳</Text>
              <Text style={styles.ruleLine}>{line}</Text>
            </View>
          ))}
          <View style={styles.ruleDivider} />
          <View style={styles.kv}><Text style={styles.muted}>Minimum bid</Text><Text style={styles.kvValue}>{a.minimumBid.toLocaleString()} pins</Text></View>
          <View style={styles.kv}><Text style={styles.muted}>Opens</Text><Text style={styles.kvValue}>{formatCloseTime(a.opensAt)}</Text></View>
          <View style={styles.kv}><Text style={styles.muted}>Closes</Text><Text style={styles.kvValue}>{formatCloseTime(a.closesAt)}</Text></View>
        </View>

        {/* My bid (owner-only; RLS means others never receive this row). */}
        {open && a.myBidAmount != null && (
          <>
            <Text style={styles.sectionLabel}>YOUR SEALED BID</Text>
            <TouchableOpacity style={styles.card} onPress={() => setBidRevealed(r => !r)} activeOpacity={0.8}>
              <View style={styles.kv}>
                <Text style={styles.muted}>{bidRevealed ? 'Your pledge' : 'Tap to reveal'}</Text>
                <Text style={styles.kvValue}>{bidRevealed ? `${a.myBidAmount.toLocaleString()} pins` : '•••'}</Text>
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
                      <Text style={styles.kvValue}>{w.price.toLocaleString()} pins</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.kv}>
                    <Text style={styles.muted}>Won by {a.winnerName}</Text>
                    <Text style={styles.kvValue}>{a.winningPrice?.toLocaleString()} pins</Text>
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
                  <Text style={styles.kvValue}>-{b.feePaid.toLocaleString()} pins</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Actions */}
        {open && !hammerFalling && (
          <>
            <Button
              label={a.myBidAmount != null ? 'Edit Bid' : 'Place Sealed Bid'}
              size="lg"
              onPress={() => setBidOpen(true)}
              style={styles.cta}
            />
          </>
        )}
      </ScrollView>

      {bidOpen && (
        <AuctionBidSheet auction={a} balance={balance} onClose={() => setBidOpen(false)} onDone={reload} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

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

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  ruleBullet: { fontSize: 13, lineHeight: 19, marginRight: 10 },
  ruleLine: { flex: 1, fontFamily: fonts.barlow, fontSize: 13, color: colors.text, lineHeight: 19 },
  ruleDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
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
    margin: 16,
    alignItems: 'center',
  },
})
