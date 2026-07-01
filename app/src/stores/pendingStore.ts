import { create } from 'zustand'

interface PendingStore {
  pendingRSVP: Record<string, string>
  pendingScores: Record<string, string>
  genFillMode: string
  genAvgSource: string
  genTeams: any | null
  genNumTeams: number
  genNumGames: number
  genTeamSize: number
  genFillToSize: boolean
  genSwapTarget: any | null
  set: (partial: Partial<PendingStore>) => void
}

export const usePendingStore = create<PendingStore>((set) => ({
  pendingRSVP: {},
  pendingScores: {},
  genFillMode: 'League Avg',
  genAvgSource: 'all-time',
  genTeams: null,
  genNumTeams: 4,
  genNumGames: 2,
  genTeamSize: 3,
  genFillToSize: false,
  genSwapTarget: null,
  set: (partial) => set(partial),
}))
