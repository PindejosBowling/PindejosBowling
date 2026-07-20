import { useCallback, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import AuctionBankBackdrop from '../components/pixelart/AuctionBankBackdrop'
import AuctionCard from '../components/auction/AuctionCard'
import AuctionBidSheet from '../components/auction/AuctionBidSheet'
import MyItemRow from '../components/auction/MyItemRow'
import ItemInfoSheet from '../components/auction/ItemInfoSheet'
import BalancePill from '../components/ui/BalancePill'
import EmptyCard from '../components/ui/EmptyCard'
import ToggleGroup from '../components/ui/ToggleGroup'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import { EXPLAINERS } from '../data/pinsinoExplainers'
import { useAuctionHouseData } from '../hooks/useAuctionHouseData'
import { useEconomyRefresh } from '../hooks/useEconomyRefresh'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { AuctionView, InventoryGroupView, auctionSections, groupInventory } from '../utils/auction'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>
type Segment = 'floor' | 'items'

export default function AuctionHouseScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  // Admin controls live on AuctionHouseAdmin (Pinsino Admin → Auction House) —
  // this screen is purely the player-facing floor.
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, balance, auctions, myItems, reload } = useAuctionHouseData(playerId, pinsinoViewSeasonId)

  // The marketplace and the locker are different jobs — split into segments
  // instead of one long interleaved scroll.
  const [segment, setSegment] = useState<Segment>('floor')
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [settledOpen, setSettledOpen] = useState(false)
  const [bidAuction, setBidAuction] = useState<AuctionView | null>(null)
  const [infoGroup, setInfoGroup] = useState<InventoryGroupView | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  // Refresh on return (e.g. after bidding on detail). Silent after first load.
  // Badges reload alongside the data so the auction count never goes stale.
  const reloadAll = useEconomyRefresh(reload)
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

  const sections = useMemo(() => auctionSections(auctions), [auctions])
  const itemGroups = useMemo(() => groupInventory(myItems), [myItems])

  const readyCount = useMemo(
    () => myItems.filter(i => i.consumedAt == null).length,
    [myItems],
  )

  // Demoted sections stay one tap away; Scheduled auto-expands when nothing is
  // open so the Floor never looks dead while auctions are queued up.
  const scheduledExpanded = scheduledOpen || sections.open.length === 0
  const collapsedSection = (
    title: string,
    rows: AuctionView[],
    expanded: boolean,
    onToggle: () => void,
  ) =>
    rows.length > 0 ? (
      <>
        <TouchableOpacity style={styles.accordionHeader} onPress={onToggle} activeOpacity={0.7}>
          <Text style={styles.accordionChevron}>{expanded ? '▾' : '▸'}</Text>
          <Text style={styles.sectionLabel}>{title} ({rows.length})</Text>
        </TouchableOpacity>
        {expanded && rows.map(a => (
          <AuctionCard
            key={a.id}
            auction={a}
            onPress={() => navigation.navigate('AuctionDetail', { auctionId: a.id })}
          />
        ))}
      </>
    ) : null

  const floorEmpty = sections.open.length === 0 && sections.scheduled.length === 0 && sections.settled.length === 0

  return (
    <ScreenContainer
      title="Auction House"
      subtitle="Secret bids for big prizes"
      backdrop={<AuctionBankBackdrop />}
      loading={loading}
      onRefresh={reloadAll}
      onHelp={() => setHelpOpen(true)}
    >
        {readOnly && <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />}

        <BalancePill balance={balance} />

        <ToggleGroup<Segment>
          variant="bar"
          options={[
            { key: 'floor', label: 'THE FLOOR' },
            { key: 'items', label: `MY ITEMS${readyCount > 0 ? ` (${readyCount})` : ''}` },
          ]}
          value={segment}
          onChange={setSegment}
          style={styles.segments}
        />

        {segment === 'floor' && (
          floorEmpty ? (
            <EmptyCard
              text={readOnly
                ? 'No auctions to review for this season.'
                : 'Nothing on the block — check back when the House lists something worth fighting over.'}
            />
          ) : (
            <>
              {sections.open.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>OPEN AUCTIONS ({sections.open.length})</Text>
                  {sections.open.map(a => (
                    <AuctionCard
                      key={a.id}
                      auction={a}
                      onPress={() => navigation.navigate('AuctionDetail', { auctionId: a.id })}
                      onBid={readOnly ? undefined : () => setBidAuction(a)}
                    />
                  ))}
                </>
              )}
              {collapsedSection('SCHEDULED', sections.scheduled, scheduledExpanded, () => setScheduledOpen(o => !o))}
              {collapsedSection('RECENTLY SETTLED', sections.settled, settledOpen, () => setSettledOpen(o => !o))}
            </>
          )
        )}

        {segment === 'items' && (
          itemGroups.length === 0 ? (
            <EmptyCard text="No items yet — win one at auction and it lands here." />
          ) : (
            <>
              {itemGroups.map(g => (
                <MyItemRow key={`${g.itemKey}:${g.expired}`} group={g} onPress={() => setInfoGroup(g)} />
              ))}
              <Text style={styles.itemsFootnote}>
                Items are spent at the Sportsbook — tap one to see where.
              </Text>
            </>
          )
        )}

        {/* Modal-based sheets: they render in the native overlay layer, so
            mounting inside the ScrollView children is visually identical. */}
        {bidAuction && (
          <AuctionBidSheet
            auction={bidAuction}
            balance={balance}
            onClose={() => setBidAuction(null)}
            onDone={reloadAll}
          />
        )}
        {infoGroup && (
          <ItemInfoSheet
            group={infoGroup}
            onClose={() => setInfoGroup(null)}
            onUseAtSportsbook={readOnly || infoGroup.expired ? undefined : () => {
              setInfoGroup(null)
              navigation.navigate('Sportsbook')
            }}
          />
        )}
        {helpOpen && (
          <FeatureExplainerSheet
            explainer={EXPLAINERS.auctionHouse}
            subsection={EXPLAINERS.items}
            onClose={() => setHelpOpen(false)}
          />
        )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  segments: { marginBottom: 14 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  accordionHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  accordionChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginRight: 8,
    marginBottom: 4,
  },

  itemsFootnote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
})
