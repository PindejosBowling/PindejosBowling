import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text } from 'react-native'
import { colors, fonts } from '../theme'
import { useNotificationStore } from '../stores/notificationStore'
import { totalCount } from '../utils/notifications'
import { SHOW_PINSINO } from '../utils/featureFlags'

import MatchupsScreen from '../screens/MatchupsScreen'
import RsvpScreen from '../screens/RsvpScreen'
import StandingsStackNavigator from './StandingsStackNavigator'
import PinsinoStackNavigator from './PinsinoStackNavigator'
import MoreStackNavigator from './MoreStackNavigator'

const Tab = createBottomTabNavigator()

function tabIcon(emoji: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color }}>{emoji}</Text>
  )
}

export default function RootNavigator() {
  // Aggregate pending-action count across all Pinsino notification sources.
  const pinsinoBadge = useNotificationStore(s => totalCount(s.counts))

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Freeze blurred tabs so their (never-unmounted) screen trees stop
        // re-rendering and re-running effects on shared-store changes while
        // off-view. Screens reload on focus, so this is transparent.
        freezeOnBlur: true,
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
        options={{ tabBarLabel: 'Standings', tabBarIcon: tabIcon('🏆') }}
      />
      <Tab.Screen
        name="RSVP"
        component={RsvpScreen}
        options={{ tabBarLabel: 'RSVP', tabBarIcon: tabIcon('📋') }}
      />
      <Tab.Screen
        name="Matchups"
        component={MatchupsScreen}
        options={{ tabBarLabel: 'Matchups', tabBarIcon: tabIcon('🎳') }}
      />
      <Tab.Screen
        name="Pinsino"
        component={PinsinoStackNavigator}
        options={{
          tabBarLabel: 'Pinsino',
          tabBarIcon: tabIcon('🏦'),
          // Hidden (not unregistered) while SHOW_PINSINO is off — the route
          // and all Pinsino functionality remain intact.
          tabBarItemStyle: SHOW_PINSINO ? undefined : { display: 'none' },
          tabBarBadge:
            SHOW_PINSINO && pinsinoBadge > 0 ? (pinsinoBadge > 99 ? '99+' : pinsinoBadge) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.danger,
            color: colors.bg,
            fontFamily: fonts.barlowCondensedHeavy,
            fontSize: 10,
            lineHeight: 14,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
          },
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackNavigator}
        options={{ tabBarLabel: 'More', tabBarIcon: tabIcon('⋯') }}
      />
    </Tab.Navigator>
  )
}
