import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type UserRole = 'player' | 'admin'

interface AuthStore {
  role: UserRole | null
  isHydrated: boolean
  setRole: (role: UserRole | null) => Promise<void>
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  role: null,
  isHydrated: false,
  setRole: async (role) => {
    set({ role })
    if (role) {
      await AsyncStorage.setItem('pb_role', role)
    } else {
      await AsyncStorage.removeItem('pb_role')
    }
  },
  hydrate: async () => {
    const stored = (await AsyncStorage.getItem('pb_role')) as UserRole | null
    set({ role: stored, isHydrated: true })
  },
}))
