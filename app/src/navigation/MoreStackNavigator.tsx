import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { MoreStackParamList } from './types'

import MoreHomeScreen from '../screens/MoreHomeScreen'
import LeagueRecordsScreen from '../screens/LeagueRecordsScreen'
import HeadToHeadScreen from '../screens/HeadToHeadScreen'
import ChemistryScreen from '../screens/ChemistryScreen'
import SeasonHistoryScreen from '../screens/SeasonHistoryScreen'
import TrashBoardScreen from '../screens/TrashBoardScreen'
import PlayoffsScreen from '../screens/PlayoffsScreen'
import PlayerManagementScreen from '../screens/PlayerManagementScreen'

const Stack = createNativeStackNavigator<MoreStackParamList>()

export default function MoreStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="MoreHome" component={MoreHomeScreen} options={{ title: 'More' }} />
      <Stack.Screen name="LeagueRecords" component={LeagueRecordsScreen} options={{ title: 'League Records' }} />
      <Stack.Screen name="HeadToHead" component={HeadToHeadScreen} options={{ title: 'Head to Head' }} />
      <Stack.Screen name="Chemistry" component={ChemistryScreen} options={{ title: 'Chemistry' }} />
      <Stack.Screen name="SeasonHistory" component={SeasonHistoryScreen} options={{ title: 'Season History' }} />
      <Stack.Screen name="TrashBoard" component={TrashBoardScreen} options={{ title: 'Trash Board' }} />
      <Stack.Screen name="Playoffs" component={PlayoffsScreen} options={{ title: 'Playoffs' }} />
      <Stack.Screen name="PlayerManagement" component={PlayerManagementScreen} options={{ title: 'Player Management' }} />
    </Stack.Navigator>
  )
}
