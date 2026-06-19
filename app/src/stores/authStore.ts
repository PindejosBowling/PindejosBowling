import { create } from 'zustand'
import { supabase } from '../utils/supabase/client'
import { players } from '../utils/supabase/db'
import { READ_ONLY_MODE } from '../utils/featureFlags'
import { setReadOnly } from '../utils/readOnlyGate'

export type UserRole = 'player' | 'admin'

// Read-only "guest" account, used only while READ_ONLY_MODE is on. It is a real
// authenticated account (so every authenticated RLS read + avatar signed-URL
// works unchanged) whose only job is to let visitors browse without logging in.
const GUEST_EMAIL = process.env.EXPO_PUBLIC_GUEST_EMAIL
const GUEST_PASSWORD = process.env.EXPO_PUBLIC_GUEST_PASSWORD

interface AuthStore {
  role: UserRole | null
  userId: string | null
  playerId: string | null
  playerName: string | null
  // True whenever the app is in compliance read-only mode (guest session, or a
  // real user opening the app while READ_ONLY_MODE is on). Mirrored into
  // readOnlyGate so the Supabase client blocks all writes.
  isReadOnly: boolean
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
  isReadOnly: false,
  isHydrated: false,

  hydrate: async () => {
    const { data: { session } } = await supabase.auth.getSession()

    if (session?.user) {
      // A device still holding the guest session after the flag is flipped off
      // must be returned to login (detected by the guest email).
      if (!READ_ONLY_MODE && GUEST_EMAIL && session.user.email === GUEST_EMAIL) {
        await supabase.auth.signOut()
        set({ role: null, userId: null, playerId: null, playerName: null, isReadOnly: false, isHydrated: true })
      } else {
        const resolved = await resolveSession(session.user.id)
        // Compliance: while the flag is on, even a real session is read-only.
        set({ ...resolved, userId: session.user.id, isReadOnly: READ_ONLY_MODE, isHydrated: true })
      }
    } else if (READ_ONLY_MODE) {
      // No session + login disabled → auto-sign-in as the shared guest so the
      // app can render real data in read-only mode. Stay on the splash until
      // this resolves.
      if (GUEST_EMAIL && GUEST_PASSWORD) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: GUEST_EMAIL,
          password: GUEST_PASSWORD,
        })
        if (!error && data.user) {
          const resolved = await resolveSession(data.user.id)
          set({ ...resolved, userId: data.user.id, isReadOnly: true, isHydrated: true })
        } else {
          // Sign-in failed despite creds being present (bad password, account
          // missing). Surface the locked-out state rather than spinning forever.
          console.warn('[authStore] Guest sign-in failed:', error?.message)
          set({ isReadOnly: true, isHydrated: true })
        }
      } else {
        // Creds undefined in the bundle — almost always means the dev server
        // wasn't restarted after EXPO_PUBLIC_GUEST_* were added to .env.local
        // (EXPO_PUBLIC_* are inlined at build time). Restart: expo start --clear.
        console.warn(
          '[authStore] READ_ONLY_MODE is on but EXPO_PUBLIC_GUEST_EMAIL/PASSWORD are missing from the bundle. Restart Expo with --clear.',
        )
        set({ isReadOnly: true, isHydrated: true })
      }
    } else {
      set({ isHydrated: true })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const resolved = await resolveSession(session.user.id)
        set({ ...resolved, userId: session.user.id, isReadOnly: READ_ONLY_MODE })
      } else {
        set({ role: null, userId: null, playerId: null, playerName: null, isReadOnly: false })
      }
    })
  },

  signOut: async () => {
    set({ role: null, userId: null, playerId: null, playerName: null, isReadOnly: false })
    await supabase.auth.signOut()
  },
}))

// Mirror read-only state into the module-level gate the Supabase client reads,
// so the guarded fetch enforces it without importing the store.
useAuthStore.subscribe((state) => setReadOnly(state.isReadOnly))
