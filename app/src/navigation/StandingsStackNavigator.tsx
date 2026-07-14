import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { StandingsStackParamList } from './types'

import StandingsScreen from '../screens/StandingsScreen'
import PlayerDetailScreen from '../screens/PlayerDetailScreen'
import FrameStatsScreen from '../screens/FrameStatsScreen'

const Stack = createNativeStackNavigator<StandingsStackParamList>()

export default function StandingsStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        // Freeze screens beneath the focused one so the stack of never-unmounted
        // screens stops re-rendering and re-running effects while off-view.
        // Screens reload on focus, so this is transparent.
        freezeOnBlur: true,
      }}
    >
      <Stack.Screen name="StandingsList" component={StandingsScreen} options={{ title: 'Standings' }} />
      <Stack.Screen name="PlayerDetail" component={PlayerDetailScreen} options={{ title: 'Player' }} />
      <Stack.Screen name="FrameStats" component={FrameStatsScreen} options={{ title: 'Game Details' }} />
    </Stack.Navigator>
  )
}
