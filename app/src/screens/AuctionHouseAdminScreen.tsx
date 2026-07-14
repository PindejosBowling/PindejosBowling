import { useCallback, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import EmptyCard from '../components/ui/EmptyCard'
import Button from '../components/ui/Button'
import AuctionCard from '../components/auction/AuctionCard'
import AuctionCreateModal from '../components/auction/AuctionCreateModal'
import AuctionAdminActionModal from '../components/auction/AuctionAdminActionModal'
import CatalogItemModal from '../components/auction/CatalogItemModal'
import GrantItemSheet from '../components/auction/GrantItemSheet'
import AuctionHouseStatusSheet from '../components/auction/AuctionHouseStatusSheet'
import AdminInventoryList from '../components/auction/AdminInventoryList'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import { useAuctionAdminData } from '../hooks/useAuctionAdminData'
import { useAuthStore } from '../stores/authStore'
import { AdminInventoryItemView, AuctionView, CatalogItemAdminView, SOURCE_LABEL, auctionSections } from '../utils/auction'
import { formatCloseTime } from '../utils/formatting'
import { inventoryItems } from '../utils/supabase/db'

// The single home of Auction House administration: every auction action
// (create / edit / open now / settle now / cancel / reverse), item-catalog
// curation, and item grants. Player-facing screens carry no admin controls.
export default function AuctionHouseAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, auctions, catalog, inventory, playerOptions, houseClosed, houseClosedMessage, reload } = useAuctionAdminData()

  const [createOpen, setCreateOpen] = useState(false)
  const [manageAuction, setManageAuction] = useState<AuctionView | null>(null)
  const [editAuction, setEditAuction] = useState<AuctionView | null>(null)
  const [catalogModal, setCatalogModal] = useState<{ initial?: CatalogItemAdminView } | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [removeItem, setRemoveItem] = useState<AdminInventoryItemView | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const sections = useMemo(() => auctionSections(auctions), [auctions])

  if (!isAdmin) {
    return (
      <ScreenContainer title="Auction House Admin">
        <EmptyCard text="Admins only" />
      </ScreenContainer>
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
    <ScreenContainer
      title="Auction House Admin"
      subtitle="The block, the catalog, the grants"
      loading={loading}
      onRefresh={reload}
    >
        {/* Kill-switch: closing paints a status over the Pinsino tile and blocks
            entry to the player-facing Auction House. */}
        <TouchableOpacity
          style={[styles.statusCard, houseClosed && styles.statusCardClosed]}
          onPress={() => setStatusOpen(true)}
          activeOpacity={0.8}
        >
          <View style={styles.statusText}>
            <Text style={[styles.statusValue, houseClosed && styles.statusValueClosed]}>
              {houseClosed ? 'CLOSED' : 'OPEN'}
            </Text>
            <Text style={styles.statusSub}>
              {houseClosed
                ? (houseClosedMessage?.trim() || 'Players can’t enter — status shown on the tile')
                : 'The block is open — tap to close'}
            </Text>
          </View>
          <Text style={styles.statusEdit}>EDIT ›</Text>
        </TouchableOpacity>

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
        <Button label="Grant Item to Player" variant="outline" onPress={() => setGrantOpen(true)} style={styles.topBtn} />

        <Text style={styles.sectionLabel}>PLAYER INVENTORY</Text>
        <Text style={styles.sectionHint}>Remove an item from a player’s inventory to undo a grant. Only unused items can be removed.</Text>
        <AdminInventoryList groups={inventory} onRemove={setRemoveItem} />

      {/* Modal-based sheets: render in the native overlay layer, so mounting
          inside the ScrollView children is visually identical. */}
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
      {removeItem && (
        <ConfirmActionSheet
          title="Remove item?"
          subtitle={`${removeItem.icon} ${removeItem.name} — ${removeItem.playerName}`}
          confirmLabel="Remove Item"
          confirmVariant="danger"
          action={() => inventoryItems.revoke(removeItem.id)}
          successMessage="Item removed from inventory"
          failureMessage="Couldn’t remove the item"
          onClose={() => setRemoveItem(null)}
          onDone={reload}
        >
          <Text style={styles.confirmBody}>
            This permanently deletes {removeItem.playerName}’s “{removeItem.name}” ({SOURCE_LABEL[removeItem.source]},
            granted {formatCloseTime(removeItem.grantedAt)}). It cannot be undone. Used items can’t be removed here.
          </Text>
        </ConfirmActionSheet>
      )}
      {statusOpen && (
        <AuctionHouseStatusSheet
          initialClosed={houseClosed}
          initialMessage={houseClosedMessage}
          onClose={() => setStatusOpen(false)}
          onDone={reload}
        />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  topBtn: { marginTop: 8, marginBottom: 14 },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  statusCardClosed: { borderColor: colors.danger },
  statusText: { flex: 1, marginRight: 12 },
  statusValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, letterSpacing: 1.5, color: colors.accent },
  statusValueClosed: { color: colors.danger },
  statusSub: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 16 },
  statusEdit: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1, color: colors.accent },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },
  sectionHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 12,
  },
  confirmBody: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    marginTop: 4,
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
