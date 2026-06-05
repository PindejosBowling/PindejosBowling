import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { BettingStackParamList } from './types'

import BettingScreen from '../screens/BettingScreen'
import PlayerBettingDetailScreen from '../screens/PlayerBettingDetailScreen'

const Stack = createNativeStackNavigator<BettingStackParamList>()

export default function BettingStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="BettingHome" component={BettingScreen} options={{ title: 'Pinsino' }} />
      <Stack.Screen name="PlayerBettingDetail" component={PlayerBettingDetailScreen} options={{ title: 'Player Bets' }} />
    </Stack.Navigator>
  )
}
