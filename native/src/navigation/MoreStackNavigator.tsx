import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { MoreStackParamList } from './types'

import MoreHomeScreen from '../screens/MoreHomeScreen'
import PlayerDetailScreen from '../screens/PlayerDetailScreen'
import LeagueRecordsScreen from '../screens/LeagueRecordsScreen'
import HeadToHeadScreen from '../screens/HeadToHeadScreen'
import ChemistryScreen from '../screens/ChemistryScreen'
import SeasonHistoryScreen from '../screens/SeasonHistoryScreen'
import TrashBoardScreen from '../screens/TrashBoardScreen'
import PlayoffsScreen from '../screens/PlayoffsScreen'

const Stack = createNativeStackNavigator<MoreStackParamList>()

export default function MoreStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="MoreHome" component={MoreHomeScreen} />
      <Stack.Screen name="PlayerDetail" component={PlayerDetailScreen} />
      <Stack.Screen name="LeagueRecords" component={LeagueRecordsScreen} />
      <Stack.Screen name="HeadToHead" component={HeadToHeadScreen} />
      <Stack.Screen name="Chemistry" component={ChemistryScreen} />
      <Stack.Screen name="SeasonHistory" component={SeasonHistoryScreen} />
      <Stack.Screen name="TrashBoard" component={TrashBoardScreen} />
      <Stack.Screen name="Playoffs" component={PlayoffsScreen} />
    </Stack.Navigator>
  )
}
