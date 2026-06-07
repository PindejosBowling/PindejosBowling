import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { PinsinoStackParamList } from './types'

import PinsinoScreen from '../screens/PinsinoScreen'
import PinsinoLeaderboardScreen from '../screens/PinsinoLeaderboardScreen'
import SportsbookScreen from '../screens/SportsbookScreen'
import LoanSharkScreen from '../screens/LoanSharkScreen'
import PlayerPinsinoScreen from '../screens/PlayerPinsinoScreen'
import PvPScreen from '../screens/PvPScreen'
import PvPBoardScreen from '../screens/PvPBoardScreen'
import PvPCreateScreen from '../screens/PvPCreateScreen'

const Stack = createNativeStackNavigator<PinsinoStackParamList>()

export default function PinsinoStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="PinsinoHome" component={PinsinoScreen} options={{ title: 'Pinsino' }} />
      <Stack.Screen name="PinsinoLeaderboard" component={PinsinoLeaderboardScreen} options={{ title: 'Leaderboard' }} />
      <Stack.Screen name="Sportsbook" component={SportsbookScreen} options={{ title: 'Sportsbook' }} />
      <Stack.Screen name="LoanShark" component={LoanSharkScreen} options={{ title: 'Loan Shark' }} />
      <Stack.Screen name="PlayerPinsino" component={PlayerPinsinoScreen} options={{ title: 'Player Bets' }} />
      <Stack.Screen name="PvP" component={PvPScreen} options={{ title: 'PvP' }} />
      <Stack.Screen name="PvPBoard" component={PvPBoardScreen} options={{ title: 'Challenge Board' }} />
      <Stack.Screen name="PvPCreate" component={PvPCreateScreen} options={{ title: 'New Challenge' }} />
    </Stack.Navigator>
  )
}
