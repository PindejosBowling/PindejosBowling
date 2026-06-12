import { useCallback, useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import PixelArtBackdrop from '../components/pixelart/PixelArtBackdrop'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import AuctionCard from '../components/auction/AuctionCard'
import MyItemRow from '../components/auction/MyItemRow'
import ItemInfoSheet from '../components/auction/ItemInfoSheet'
import AuctionCreateModal from '../components/auction/AuctionCreateModal'
import { useAuctionHouseData } from '../hooks/useAuctionHouseData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { AuctionView, InventoryGroupView, auctionSections, groupInventory } from '../utils/auction'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function AuctionHouseScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, balance, auctions, myItems, reload } = useAuctionHouseData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [createOpen, setCreateOpen] = useState(false)
  const [infoGroup, setInfoGroup] = useState<InventoryGroupView | null>(null)

  // Refresh on return (e.g. after bidding on detail). Silent after first load.
  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const sections = useMemo(() => auctionSections(auctions), [auctions])
  const itemGroups = useMemo(() => groupInventory(myItems), [myItems])

  if (loading) return <LoadingView label="Loading…" />

  const auctionSection = (title: string, rows: AuctionView[]) =>
    rows.length > 0 ? (
      <>
        <Text style={styles.sectionLabel}>{title} ({rows.length})</Text>
        {rows.map(a => (
          <AuctionCard
            key={a.id}
            auction={a}
            onPress={() => navigation.navigate('AuctionDetail', { auctionId: a.id })}
          />
        ))}
      </>
    ) : null

  const noAuctions = sections.open.length === 0 && sections.scheduled.length === 0 && sections.settled.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PixelArtBackdrop scene="auction" />
      <ScreenHeader title="Auction House" subtitle="Sealed bids · the hammer falls on its own" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <View style={styles.balancePill}>
          <Text style={styles.balancePillLabel}>BALANCE</Text>
          <Text style={styles.balancePillValue}>{balance.toLocaleString()} pins</Text>
        </View>

        {isAdmin && (
          <Button label="+ Create Auction" variant="outline" onPress={() => setCreateOpen(true)} style={styles.createBtn} />
        )}

        {noAuctions ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Nothing on the block — check back when the House lists something worth fighting over.</Text>
          </View>
        ) : (
          <>
            {auctionSection('OPEN AUCTIONS', sections.open)}
            {auctionSection('SCHEDULED', sections.scheduled)}
          </>
        )}

        {itemGroups.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MY ITEMS ({myItems.length})</Text>
            {itemGroups.map(g => (
              <MyItemRow key={`${g.itemKey}:${g.expired}`} group={g} onPress={() => setInfoGroup(g)} />
            ))}
          </>
        )}

        {auctionSection('RECENTLY SETTLED', sections.settled)}
      </ScrollView>

      {createOpen && (
        <AuctionCreateModal onClose={() => setCreateOpen(false)} onDone={reload} />
      )}
      {infoGroup && (
        <ItemInfoSheet group={infoGroup} onClose={() => setInfoGroup(null)} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balancePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  balancePillLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted },
  balancePillValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },

  createBtn: { marginBottom: 14 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
})
