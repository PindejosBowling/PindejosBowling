import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { StandingsStackParamList } from './types'

import StandingsScreen from '../screens/StandingsScreen'
import PlayerDetailScreen from '../screens/PlayerDetailScreen'

const Stack = createNativeStackNavigator<StandingsStackParamList>()

export default function StandingsStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="StandingsList" component={StandingsScreen} />
      <Stack.Screen name="PlayerDetail" component={PlayerDetailScreen} />
    </Stack.Navigator>
  )
}
