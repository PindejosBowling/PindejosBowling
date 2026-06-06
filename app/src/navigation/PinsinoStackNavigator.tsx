import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { PinsinoStackParamList } from './types'

import PinsinoScreen from '../screens/PinsinoScreen'
import PlayerPinsinoScreen from '../screens/PlayerPinsinoScreen'

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
      <Stack.Screen name="PlayerPinsino" component={PlayerPinsinoScreen} options={{ title: 'Player Bets' }} />
    </Stack.Navigator>
  )
}
