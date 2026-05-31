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
import Toast from './src/components/Toast'
import { usePrefsStore } from './src/stores/prefsStore'

const linking = {
  prefixes: [typeof window !== 'undefined' ? window.location.origin : ''],
  config: {
    screens: {
      Standings: {
        screens: {
          StandingsList: 'standings',
          PlayerDetail: 'standings/player/:name',
        },
      },
      RSVP: 'rsvp',
      Matchups: 'matchups',
      More: {
        screens: {
          MoreHome: 'more',
          LeagueRecords: 'more/records',
          HeadToHead: 'more/head-to-head',
          Chemistry: 'more/chemistry',
          SeasonHistory: 'more/season-history',
          TrashBoard: 'more/trash-board',
          Playoffs: 'more/playoffs',
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

  useEffect(() => {
    usePrefsStore.getState().hydrate()
  }, [])

  if (!fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <NavigationContainer linking={linking}>
        <View style={{ flex: 1 }}>
          <RootNavigator />
          <Toast />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
