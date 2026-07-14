import { auctionHouseState, auctionLedger, auctions, inventoryItems, itemCatalog, players, seasons } from '../utils/supabase/db'
import { AdminInventoryItemView, AdminInventoryPlayerGroup, AuctionView, CatalogItemAdminView, groupAdminInventory } from '../utils/auction'
import { bouncesByAuction, normalizeAuction, purchasesByAuction } from './useAuctionHouseData'
import { PlayerPickerItem } from '../components/ui/PlayerPickerModal'
import { useAsyncData } from './useAsyncData'

function normalizeAdminInventoryItem(row: any): AdminInventoryItemView {
  return {
    id: row.id,
    playerId: row.player_id,
    playerName: row.players?.name ?? 'Unknown player',
    itemKey: row.item_catalog?.key ?? '',
    icon: row.item_catalog?.icon ?? '🎟️',
    name: row.item_catalog?.name ?? 'Item',
    source: row.source,
    grantedAt: row.granted_at,
    consumedAt: row.consumed_at,
    removable: row.consumed_at == null,
  }
}

export function normalizeCatalogItem(row: any): CatalogItemAdminView {
  return {
    id: row.id,
    key: row.key,
    icon: row.icon,
    name: row.name,
    description: row.description,
    effectType: row.effect_type,
    effectParams: row.effect_params ?? {},
    activationMode: row.activation_mode,
    isActive: row.is_active,
    instanceCount: row.player_inventory_items?.[0]?.count ?? 0,
  }
}

export interface AuctionAdminData {
  loading: boolean
  auctions: AuctionView[]
  catalog: CatalogItemAdminView[]
  // Every player's inventory for the season, grouped by player (remove-item view).
  inventory: AdminInventoryPlayerGroup[]
  playerOptions: PlayerPickerItem[]
  // Current season's open/closed kill-switch (drives the status toggle + tile
  // overlay). closedMessage is the admin-authored copy (null = use default).
  houseClosed: boolean
  houseClosedMessage: string | null
  reload: () => Promise<void>
}

type AuctionAdminPayload = Pick<AuctionAdminData, 'auctions' | 'catalog' | 'inventory' | 'playerOptions' | 'houseClosed' | 'houseClosedMessage'>

const EMPTY: AuctionAdminPayload = { auctions: [], catalog: [], inventory: [], playerOptions: [], houseClosed: false, houseClosedMessage: null }

// Data for AuctionHouseAdminScreen: every auction of the season (no bid/bounce
// decoding — admin management doesn't need the viewer's sealed-bid view), the
// full catalog (incl. retired rows) with freeze-relevant instance counts, and
// the active-player list for the grant flow.
export function useAuctionAdminData(): AuctionAdminData {
  const { loading, data, reload } = useAsyncData<AuctionAdminPayload>(async () => {
    const seasonRes = await seasons.getCurrent()
    const seasonId = seasonRes.data?.id ?? null

    let auctionData: any[] = []
    let catalogData: any[] = []
    let playerData: any[] = []
    let auctionLedgerData: any[] = []
    let inventoryData: any[] = []
    let stateData: any = null
    await Promise.all([
      seasonId
        ? auctions.listBySeason(seasonId).then(({ data }) => { auctionData = data ?? [] })
        : Promise.resolve(),
      seasonId
        ? auctionLedger.listBySeason(seasonId).then(({ data }) => { auctionLedgerData = data ?? [] })
        : Promise.resolve(),
      seasonId
        ? auctionHouseState.getBySeason(seasonId).then(({ data }) => { stateData = data })
        : Promise.resolve(),
      seasonId
        ? inventoryItems.listAllForSeason(seasonId).then(({ data }) => { inventoryData = data ?? [] })
        : Promise.resolve(),
      itemCatalog.listAllWithCounts().then(({ data }) => { catalogData = data ?? [] }),
      players.listActive().then(({ data }) => { playerData = data ?? [] }),
    ])

    const bounceMap = bouncesByAuction(auctionLedgerData)
    const winnerMap = purchasesByAuction(auctionLedgerData)
    return {
      auctions: auctionData.map(row =>
        normalizeAuction(row, null, bounceMap.get(row.id) ?? [], winnerMap.get(row.id) ?? [])),
      catalog: catalogData.map(normalizeCatalogItem),
      inventory: groupAdminInventory(inventoryData.map(normalizeAdminInventoryItem)),
      playerOptions: playerData.map((p: any) => ({ id: p.id, name: p.name })),
      houseClosed: stateData?.is_closed ?? false,
      houseClosedMessage: stateData?.closed_message ?? null,
    }
  }, [], 'useAuctionAdminData')

  return { loading, ...(data ?? EMPTY), reload }
}
