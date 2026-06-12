import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import AuctionBidSheet from '../components/auction/AuctionBidSheet'
import AuctionCreateModal from '../components/auction/AuctionCreateModal'
import AuctionAdminActionModal from '../components/auction/AuctionAdminActionModal'
import { useAuctionDetailData } from '../hooks/useAuctionDetailData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { formatCountdown } from '../utils/auction'
import { formatCloseTime } from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'
import { auctions } from '../utils/supabase/db'

type Route = RouteProp<PinsinoStackParamList, 'AuctionDetail'>

export default function AuctionDetailScreen() {
  const navigation = useNavigation()
  const { params } = useRoute<Route>()
  const playerId = useAuthStore(s => s.playerId)
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const { loading, balance, auction, reload } = useAuctionDetailData(params.auctionId, playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [bidOpen, setBidOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
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

  if (loading) return <LoadingView label="Loading…" />
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

  function confirmCancelBid() {
    Alert.alert(
      'Cancel your bid?',
      'Withdraw your sealed bid? You can bid again while the auction is open.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel bid',
          style: 'destructive',
          onPress: async () => {
            const { error } = await auctions.cancelBid(a.id)
            if (error) { showToast(error.message, 'error'); return }
            showToast('Bid cancelled', 'success')
            setBidRevealed(false)
            reload()
          },
        },
      ],
    )
  }

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
          <Text style={styles.description}>{a.description}</Text>
        </View>

        {/* Live countdown / hammer */}
        {(open || scheduled) && (
          <View style={styles.countdownCard}>
            {hammerFalling ? (
              <Text style={styles.hammer}>🔨 HAMMER FALLING…</Text>
            ) : (
              <>
                <Text style={styles.countdownLabel}>{open ? 'CLOSES IN' : 'OPENS IN'}</Text>
                <Text style={styles.countdownValue}>{countdown}</Text>
              </>
            )}
            {open && (
              <Text style={styles.bidderLine}>
                {a.bidderCount === 0
                  ? 'No sealed bids yet'
                  : `${a.bidderCount} sealed bid${a.bidderCount === 1 ? '' : 's'} in`}
              </Text>
            )}
          </View>
        )}

        {/* Terms */}
        <Text style={styles.sectionLabel}>THE RULES</Text>
        <View style={styles.card}>
          <View style={styles.kv}><Text style={styles.muted}>Minimum bid</Text><Text style={styles.kvValue}>{a.minimumBid.toLocaleString()} pins</Text></View>
          <View style={styles.kv}><Text style={styles.muted}>Bids are sealed</Text><Text style={styles.kvValue}>only the count is public</Text></View>
          <View style={styles.kv}><Text style={styles.muted}>Edit / cancel</Text><Text style={styles.kvValue}>any time before close</Text></View>
          <View style={styles.kv}><Text style={styles.muted}>Bounce penalty</Text><Text style={styles.kvValue}>min(balance, {a.bounceFee}) pins</Text></View>
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
                <View style={styles.kv}>
                  <Text style={styles.muted}>Won by {a.winnerName}</Text>
                  <Text style={styles.kvValue}>{a.winningPrice?.toLocaleString()} pins</Text>
                </View>
              ) : (
                <Text style={styles.muted}>No sale — no valid bids met the minimum.</Text>
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
            {a.myBidAmount != null && (
              <Button variant="outline" tone="danger" label="Cancel Bid" onPress={confirmCancelBid} style={styles.cancelCta} />
            )}
          </>
        )}

        {isAdmin && (
          <Button variant="outline" label="Manage (admin)" onPress={() => setAdminOpen(true)} style={styles.adminCta} />
        )}
      </ScrollView>

      {bidOpen && (
        <AuctionBidSheet auction={a} balance={balance} onClose={() => setBidOpen(false)} onDone={reload} />
      )}
      {adminOpen && (
        <AuctionAdminActionModal
          auction={a}
          onClose={() => setAdminOpen(false)}
          onDone={reload}
          onEdit={() => { setAdminOpen(false); setEditOpen(true) }}
        />
      )}
      {editOpen && (
        <AuctionCreateModal initial={a} onClose={() => setEditOpen(false)} onDone={reload} />
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

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, flex: 1, marginRight: 8 },

  cta: { marginTop: 6 },
  cancelCta: { marginTop: 8 },
  adminCta: { marginTop: 16 },

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
