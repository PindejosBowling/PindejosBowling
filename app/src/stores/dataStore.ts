import { create } from 'zustand'
import { apiGet } from '../api.js'

interface DataStore {
  current: any | null
  active: any | null
  roster: any | null
  rsvp: any | null
  stats: any | null
  board: any | null
  history: any | null
  champions: any | null
  generated: any | null
  settings: any | null
  loading: boolean
  error: string | null
  loadAll: () => Promise<void>
  loadActive: () => Promise<void>
}

export const useDataStore = create<DataStore>((set) => ({
  current: null, active: null, roster: null, rsvp: null,
  stats: null, board: null, history: null, champions: null,
  generated: null, settings: null, loading: false, error: null,
  loadAll: async () => {
    set({ loading: true, error: null })
    try {
      const all = await apiGet('getAll')
      set({
        current: all.currentWeek, active: all.activeWeek,
        roster: all.roster, rsvp: all.rsvp, stats: all.stats,
        board: all.board, history: all.history, champions: all.champions,
        generated: all.generated, settings: all.settings,
      })
    } catch (e: any) {
      set({ error: e.message })
    } finally {
      set({ loading: false })
    }
  },
  loadActive: async () => {
    set({ loading: true, error: null })
    try {
      const data = await apiGet('getActiveWeek')
      set({ active: data })
    } catch (e: any) {
      set({ error: e.message })
    } finally {
      set({ loading: false })
    }
  },
}))
