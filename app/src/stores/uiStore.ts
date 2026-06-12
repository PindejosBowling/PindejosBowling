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
  toasts: Toast[]
  // Bumped by useWeekClock (Realtime `weeks` events / app foreground) so
  // week-derived UI (AppHeader) refetches the current week from the DB.
  weekVersion: number
  set: (partial: Partial<UiStore>) => void
  showToast: (msg: string, type?: string) => void
  bumpWeekVersion: () => void
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
  toasts: [],
  weekVersion: 0,
  set: (partial) => set(partial),
  bumpWeekVersion: () => set((state) => ({ weekVersion: state.weekVersion + 1 })),
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
