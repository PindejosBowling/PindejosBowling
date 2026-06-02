import { create } from 'zustand'
import { supabase } from '../utils/supabase/client'

export type UserRole = 'player' | 'admin'

interface AuthStore {
  role: UserRole | null
  userId: string | null
  isHydrated: boolean
  hydrate: () => void
  signOut: () => Promise<void>
}

async function fetchRole(userId: string): Promise<UserRole> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.role as UserRole) ?? 'player'
}

export const useAuthStore = create<AuthStore>((set) => ({
  role: null,
  userId: null,
  isHydrated: false,

  hydrate: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const role = await fetchRole(session.user.id)
      set({ role, userId: session.user.id, isHydrated: true })
    } else {
      set({ isHydrated: true })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const role = await fetchRole(session.user.id)
        set({ role, userId: session.user.id })
      } else {
        set({ role: null, userId: null })
      }
    })
  },

  signOut: async () => {
    set({ role: null, userId: null })
    await supabase.auth.signOut()
  },
}))
