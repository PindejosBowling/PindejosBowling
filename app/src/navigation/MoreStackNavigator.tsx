import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { MoreStackParamList } from './types'

import MoreHomeScreen from '../screens/MoreHomeScreen'
import LeagueRecordsScreen from '../screens/LeagueRecordsScreen'
import HeadToHeadScreen from '../screens/HeadToHeadScreen'
import ChemistryScreen from '../screens/ChemistryScreen'
import PastSeasonsScreen from '../screens/PastSeasonsScreen'
import TrashBoardScreen from '../screens/TrashBoardScreen'
import PlayoffsScreen from '../screens/PlayoffsScreen'
import PlayerManagementScreen from '../screens/PlayerManagementScreen'
import ProfilePicturesScreen from '../screens/ProfilePicturesScreen'
import PastGamesScreen from '../screens/PastGamesScreen'
import RegistrationScreen from '../screens/RegistrationScreen'
import PinsinoAdminScreen from '../screens/PinsinoAdminScreen'
import PinsinoAccountingScreen from '../screens/PinsinoAccountingScreen'
import PinsinoSportsbookScreen from '../screens/PinsinoSportsbookScreen'
import LoanSharkAdminScreen from '../screens/LoanSharkAdminScreen'

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
      <Stack.Screen name="PastSeasons" component={PastSeasonsScreen} options={{ title: 'Past Seasons' }} />
      <Stack.Screen name="TrashBoard" component={TrashBoardScreen} options={{ title: 'Trash Board' }} />
      <Stack.Screen name="Playoffs" component={PlayoffsScreen} options={{ title: 'Playoffs' }} />
      <Stack.Screen name="PlayerManagement" component={PlayerManagementScreen} options={{ title: 'Player Management' }} />
      <Stack.Screen name="ProfilePictures" component={ProfilePicturesScreen} options={{ title: 'Profile Pictures' }} />
      <Stack.Screen name="PastGames" component={PastGamesScreen} options={{ title: 'Past Games' }} />
      <Stack.Screen name="Registration" component={RegistrationScreen} options={{ title: 'Registration' }} />
      <Stack.Screen name="PinsinoAdmin" component={PinsinoAdminScreen} options={{ title: 'Pinsino Admin' }} />
      <Stack.Screen name="PinsinoAccounting" component={PinsinoAccountingScreen} options={{ title: 'Accounting' }} />
      <Stack.Screen name="PinsinoSportsbook" component={PinsinoSportsbookScreen} options={{ title: 'Sportsbook' }} />
      <Stack.Screen name="LoanSharkAdmin" component={LoanSharkAdminScreen} options={{ title: 'Loan Shark Admin' }} />
    </Stack.Navigator>
  )
}
