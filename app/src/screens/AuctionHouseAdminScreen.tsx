import { useCallback, useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import EmptyCard from '../components/ui/EmptyCard'
import Button from '../components/ui/Button'
import AuctionCard from '../components/auction/AuctionCard'
import AuctionCreateModal from '../components/auction/AuctionCreateModal'
import AuctionAdminActionModal from '../components/auction/AuctionAdminActionModal'
import CatalogItemModal from '../components/auction/CatalogItemModal'
import GrantItemSheet from '../components/auction/GrantItemSheet'
import { useAuctionAdminData } from '../hooks/useAuctionAdminData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { AuctionView, CatalogItemAdminView, auctionSections } from '../utils/auction'

// The single home of Auction House administration: every auction action
// (create / edit / open now / settle now / cancel / reverse), item-catalog
// curation, and item grants. Player-facing screens carry no admin controls.
export default function AuctionHouseAdminScreen() {
  const navigation = useNavigation()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, auctions, catalog, playerOptions, reload } = useAuctionAdminData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const [createOpen, setCreateOpen] = useState(false)
  const [manageAuction, setManageAuction] = useState<AuctionView | null>(null)
  const [editAuction, setEditAuction] = useState<AuctionView | null>(null)
  const [catalogModal, setCatalogModal] = useState<{ initial?: CatalogItemAdminView } | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const sections = useMemo(() => auctionSections(auctions), [auctions])

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Auction House Admin" onBack={() => navigation.goBack()} />
        <EmptyCard text="Admins only" />
      </SafeAreaView>
    )
  }

  const auctionSection = (title: string, rows: AuctionView[]) =>
    rows.length > 0 ? (
      <>
        <Text style={styles.sectionLabel}>{title} ({rows.length})</Text>
        {rows.map(a => (
          <AuctionCard key={a.id} auction={a} onPress={() => setManageAuction(a)} />
        ))}
      </>
    ) : null

  const noAuctions = sections.open.length === 0 && sections.scheduled.length === 0 && sections.settled.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Auction House Admin" subtitle="The block, the catalog, the grants" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <Button label="+ Create Auction" variant="outline" onPress={() => setCreateOpen(true)} style={styles.topBtn} />

        {noAuctions ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No auctions this season yet.</Text>
          </View>
        ) : (
          <>
            {auctionSection('OPEN', sections.open)}
            {auctionSection('SCHEDULED', sections.scheduled)}
            {auctionSection('RECENTLY SETTLED', sections.settled)}
          </>
        )}

        <Text style={styles.sectionLabel}>ITEM CATALOG ({catalog.length})</Text>
        {catalog.map(c => (
          <TouchableOpacity key={c.id} style={styles.catalogRow} onPress={() => setCatalogModal({ initial: c })} activeOpacity={0.8}>
            <Text style={styles.catalogName}>
              {c.icon} {c.name}
              {!c.isActive && <Text style={styles.retired}>  RETIRED</Text>}
            </Text>
            <Text style={styles.catalogMeta}>
              {c.effectType.replace(/_/g, ' ')} · {c.instanceCount} granted{c.instanceCount > 0 ? ' · behavior frozen' : ''}
            </Text>
          </TouchableOpacity>
        ))}
        <Button label="+ New Catalog Item" variant="outline" onPress={() => setCatalogModal({})} style={styles.topBtn} />

        <Text style={styles.sectionLabel}>GRANTS</Text>
        <Button label="Grant Item to Player" variant="outline" onPress={() => setGrantOpen(true)} />
      </ScrollView>

      {createOpen && (
        <AuctionCreateModal onClose={() => setCreateOpen(false)} onDone={reload} />
      )}
      {manageAuction && (
        <AuctionAdminActionModal
          auction={manageAuction}
          onClose={() => setManageAuction(null)}
          onDone={reload}
          onEdit={() => { setEditAuction(manageAuction); setManageAuction(null) }}
        />
      )}
      {editAuction && (
        <AuctionCreateModal initial={editAuction} onClose={() => setEditAuction(null)} onDone={reload} />
      )}
      {catalogModal && (
        <CatalogItemModal initial={catalogModal.initial} onClose={() => setCatalogModal(null)} onDone={reload} />
      )}
      {grantOpen && (
        <GrantItemSheet playerOptions={playerOptions} catalog={catalog} onClose={() => setGrantOpen(false)} onDone={reload} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  topBtn: { marginTop: 8, marginBottom: 14 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  catalogRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  catalogName: { fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3 },
  retired: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.danger },
  catalogMeta: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 3 },

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
