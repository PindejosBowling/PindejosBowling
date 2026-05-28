import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface PrefsStore {
  myName: string
  avgDisplay: string
  setMyName: (val: string) => Promise<void>
  setAvgDisplay: (val: string) => Promise<void>
  hydrate: () => Promise<void>
}

export const usePrefsStore = create<PrefsStore>((set) => ({
  myName: '',
  avgDisplay: 'last-played',
  setMyName: async (val) => {
    set({ myName: val })
    await AsyncStorage.setItem('pb_myname', val)
  },
  setAvgDisplay: async (val) => {
    set({ avgDisplay: val })
    await AsyncStorage.setItem('pb_avgdisplay', val)
  },
  hydrate: async () => {
    const myName     = await AsyncStorage.getItem('pb_myname') ?? ''
    const avgDisplay = await AsyncStorage.getItem('pb_avgdisplay') ?? 'last-played'
    set({ myName, avgDisplay })
  },
}))
