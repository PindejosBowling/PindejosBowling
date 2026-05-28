import { create } from 'zustand'

interface PendingStore {
  pendingRSVP: Record<string, string>
  pendingScores: Record<string, string>
  genFillMode: string
  genAvgSource: string
  genTeams: any | null
  genNumTeams: number
  genTeamSize: number
  genFillToSize: boolean
  genSwapTarget: any | null
  set: (partial: Partial<PendingStore>) => void
}

export const usePendingStore = create<PendingStore>((set) => ({
  pendingRSVP: {},
  pendingScores: {},
  genFillMode: 'League Avg',
  genAvgSource: 'last-season',
  genTeams: null,
  genNumTeams: 4,
  genTeamSize: 3,
  genFillToSize: false,
  genSwapTarget: null,
  set: (partial) => set(partial),
}))
