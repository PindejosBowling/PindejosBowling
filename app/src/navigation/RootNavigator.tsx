import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text } from 'react-native'
import { colors } from '../theme'

import MatchupsScreen from '../screens/MatchupsScreen'
import RsvpScreen from '../screens/RsvpScreen'
import BettingScreen from '../screens/BettingScreen'
import StandingsStackNavigator from './StandingsStackNavigator'
import MoreStackNavigator from './MoreStackNavigator'

const Tab = createBottomTabNavigator()

function tabIcon(emoji: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color }}>{emoji}</Text>
  )
}

export default function RootNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tab.Screen
        name="Standings"
        component={StandingsStackNavigator}
        options={{ tabBarLabel: 'Standings', tabBarIcon: tabIcon('📊') }}
      />
      <Tab.Screen
        name="RSVP"
        component={RsvpScreen}
        options={{ tabBarLabel: 'RSVP', tabBarIcon: tabIcon('📋') }}
      />
      <Tab.Screen
        name="Matchups"
        component={MatchupsScreen}
        options={{ tabBarLabel: 'This Week', tabBarIcon: tabIcon('🎳') }}
      />
      <Tab.Screen
        name="Betting"
        component={BettingScreen}
        options={{ tabBarLabel: 'Pinsino', tabBarIcon: tabIcon('🏦') }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackNavigator}
        options={{ tabBarLabel: 'More', tabBarIcon: tabIcon('⋯') }}
      />
    </Tab.Navigator>
  )
}
