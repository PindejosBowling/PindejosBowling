import { useState, useCallback, useEffect, useRef } from 'react'
import { auctionHouseState, auctionLedger, auctions, itemCatalog, players, seasons } from '../utils/supabase/db'
import { AuctionView, CatalogItemAdminView } from '../utils/auction'
import { bouncesByAuction, normalizeAuction, purchasesByAuction } from './useAuctionHouseData'
import { PlayerPickerItem } from '../components/ui/PlayerPickerModal'

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
  playerOptions: PlayerPickerItem[]
  // Current season's open/closed kill-switch (drives the status toggle + tile
  // overlay). closedMessage is the admin-authored copy (null = use default).
  houseClosed: boolean
  houseClosedMessage: string | null
  reload: () => Promise<void>
}

// Data for AuctionHouseAdminScreen: every auction of the season (no bid/bounce
// decoding — admin management doesn't need the viewer's sealed-bid view), the
// full catalog (incl. retired rows) with freeze-relevant instance counts, and
// the active-player list for the grant flow.
export function useAuctionAdminData(): AuctionAdminData {
  const [loading, setLoading] = useState(true)
  const [auctionList, setAuctionList] = useState<AuctionView[]>([])
  const [catalog, setCatalog] = useState<CatalogItemAdminView[]>([])
  const [playerOptions, setPlayerOptions] = useState<PlayerPickerItem[]>([])
  const [houseClosed, setHouseClosed] = useState(false)
  const [houseClosedMessage, setHouseClosedMessage] = useState<string | null>(null)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null

      let auctionData: any[] = []
      let catalogData: any[] = []
      let playerData: any[] = []
      let auctionLedgerData: any[] = []
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
        itemCatalog.listAllWithCounts().then(({ data }) => { catalogData = data ?? [] }),
        players.listActive().then(({ data }) => { playerData = data ?? [] }),
      ])

      const bounceMap = bouncesByAuction(auctionLedgerData)
      const winnerMap = purchasesByAuction(auctionLedgerData)
      setAuctionList(auctionData.map(row =>
        normalizeAuction(row, null, bounceMap.get(row.id) ?? [], winnerMap.get(row.id) ?? [])))
      setCatalog(catalogData.map(normalizeCatalogItem))
      setPlayerOptions(playerData.map((p: any) => ({ id: p.id, name: p.name })))
      setHouseClosed(stateData?.is_closed ?? false)
      setHouseClosedMessage(stateData?.closed_message ?? null)
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, auctions: auctionList, catalog, playerOptions, houseClosed, houseClosedMessage, reload: load }
}
