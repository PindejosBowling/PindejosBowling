import { create } from 'zustand'
import { supabase } from '../utils/supabase/client'
import { players } from '../utils/supabase/db'

export type UserRole = 'player' | 'admin'

interface AuthStore {
  role: UserRole | null
  userId: string | null
  playerId: string | null
  playerName: string | null
  isHydrated: boolean
  hydrate: () => void
  signOut: () => Promise<void>
}

async function resolveSession(userId: string) {
  const { data } = await players.getByUserId(userId)
  return {
    role: (data?.role ?? 'player') as UserRole,
    playerId: data?.id ?? null,
    playerName: data?.name ?? null,
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  role: null,
  userId: null,
  playerId: null,
  playerName: null,
  isHydrated: false,

  hydrate: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const resolved = await resolveSession(session.user.id)
      set({ ...resolved, userId: session.user.id, isHydrated: true })
    } else {
      set({ isHydrated: true })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const resolved = await resolveSession(session.user.id)
        set({ ...resolved, userId: session.user.id })
      } else {
        set({ role: null, userId: null, playerId: null, playerName: null })
      }
    })
  },

  signOut: async () => {
    set({ role: null, userId: null, playerId: null, playerName: null })
    await supabase.auth.signOut()
  },
}))
