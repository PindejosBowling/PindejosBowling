import React, { useEffect } from 'react'
import { View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import {
  BarlowCondensed_400Regular,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
  BarlowCondensed_900Black,
} from '@expo-google-fonts/barlow-condensed'
import {
  Barlow_400Regular,
  Barlow_600SemiBold,
} from '@expo-google-fonts/barlow'

import RootNavigator from './src/navigation/RootNavigator'
import LoginScreen from './src/screens/LoginScreen'
import Toast from './src/components/Toast'
import { useAuthStore } from './src/stores/authStore'

const BASE = 'PindejosBowling'

const linking = {
  prefixes: [typeof window !== 'undefined' && window.location ? window.location.origin : ''],
  config: {
    screens: {
      Standings: {
        screens: {
          StandingsList: `${BASE}/standings`,
          PlayerDetail: `${BASE}/standings/player/:name`,
        },
      },
      RSVP: `${BASE}/rsvp`,
      Matchups: `${BASE}/matchups`,
      More: {
        screens: {
          MoreHome: `${BASE}/more`,
          LeagueRecords: `${BASE}/more/records`,
          HeadToHead: `${BASE}/more/head-to-head`,
          Chemistry: `${BASE}/more/chemistry`,
          SeasonHistory: `${BASE}/more/season-history`,
          TrashBoard: `${BASE}/more/trash-board`,
          Playoffs: `${BASE}/more/playoffs`,
        },
      },
    },
  },
}

export default function App() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_400Regular,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
    Barlow_400Regular,
    Barlow_600SemiBold,
  })

  const role = useAuthStore(s => s.role)
  const isHydrated = useAuthStore(s => s.isHydrated)

  useEffect(() => {
    useAuthStore.getState().hydrate()
  }, [])

  if (!fontsLoaded || !isHydrated) return null

  if (!role) {
    return (
      <SafeAreaProvider>
        <LoginScreen />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer linking={linking as any}>
        <View style={{ flex: 1 }}>
          <RootNavigator />
          <Toast />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
