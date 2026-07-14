import { create } from 'zustand'

interface Toast {
  id: number
  msg: string
  type: string
}

interface UiStore {
  matchupsView: string
  expandedWeek: string | null
  playerLogMode: string
  oddsRevealed: boolean
  standingsSeason: string | null
  playerSeason: string | null
  recordsSeason: string
  recordsScope: string
  chemMode: string
  chemExpanded: boolean
  h2hP1: string | null
  h2hP2: string | null
  historySeason: string | null
  // The prior (concluded) season the entire Pinsino tab is being viewed "as of",
  // read-only. null = the live/current season (default). A concrete season id puts
  // the hub leaderboard AND every Pinsino sub-surface into read-only end-of-season
  // mode. Global so the selection persists as the user moves between sub-screens.
  pinsinoViewSeasonId: string | null
  // When true, art screens hide their foreground UI so the pixel-art backdrop
  // shows in full. Toggled by the header Artwork button; reset on screen blur.
  artworkReveal: boolean
  toasts: Toast[]
  // Current season/week numbers, kept fresh by useWeekClock (Realtime `weeks`
  // events / app foreground). Fetched once at the app root and read by every
  // AppHeader, so the header's query load no longer scales with how many
  // screens are mounted.
  weekNumber: number | null
  seasonNumber: number | null
  set: (partial: Partial<UiStore>) => void
  showToast: (msg: string, type?: string) => void
  setWeekMeta: (weekNumber: number | null, seasonNumber: number | null) => void
}

export const useUiStore = create<UiStore>((set, get) => ({
  matchupsView: 'scores',
  expandedWeek: null,
  playerLogMode: 'bowled',
  oddsRevealed: false,
  standingsSeason: null,
  playerSeason: null,
  recordsSeason: 'all',
  recordsScope: 'game',
  chemMode: 'pairs',
  chemExpanded: false,
  h2hP1: null,
  h2hP2: null,
  historySeason: null,
  pinsinoViewSeasonId: null,
  artworkReveal: false,
  toasts: [],
  weekNumber: null,
  seasonNumber: null,
  set: (partial) => set(partial),
  setWeekMeta: (weekNumber, seasonNumber) => set({ weekNumber, seasonNumber }),
  showToast: (msg, type = '') => {
    const id = Date.now() + Math.random()
    set((state) => ({ toasts: [...state.toasts, { id, msg, type }] }))
    // Longer messages (e.g. full DB error text) stay up long enough to read.
    const duration = Math.min(10000, Math.max(2400, msg.length * 70))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
}))
