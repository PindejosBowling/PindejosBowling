import React, { useEffect } from 'react'
import { View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import {
  BarlowCondensed_400Regular,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
  BarlowCondensed_900Black,
} from '@expo-google-fonts/barlow-condensed'
import {
  Barlow_400Regular,
  Barlow_600SemiBold,
} from '@expo-google-fonts/barlow'

import RootNavigator from './src/navigation/RootNavigator'
import { navigationRef, flushPendingBroadcastTarget } from './src/navigation/navigationRef'
import LoginScreen from './src/screens/LoginScreen'
import Toast from './src/components/ui/Toast'
import { BetSlipProvider } from './src/components/betting/BetSlipProvider'
import { useAuthStore } from './src/stores/authStore'
import { useAvatarStore } from './src/stores/avatarStore'
import { useNotificationStore } from './src/stores/notificationStore'
import { useWeekClock } from './src/hooks/useWeekClock'
import { useOtaUpdates } from './src/hooks/useOtaUpdates'
import { useUpdateGate } from './src/hooks/useUpdateGate'
import UpdateRequiredScreen from './src/screens/UpdateRequiredScreen'
import OtaUpdatingScreen from './src/screens/OtaUpdatingScreen'
import { syncPushToken } from './src/utils/pushTokens'

const BASE = 'PindejosBowling'

// Every screen MUST have an explicit path string prefixed with BASE. React
// Navigation auto-generates a prefix-less path (e.g. `/FrameStats`) for any
// screen omitted here, which lands outside the GitHub Pages project base
// (`/PindejosBowling/`) and 404s on refresh. Keep this in sync with the
// navigators (StandingsStack / Pinsino / MoreStack) — a missing entry is a bug.
const linking = {
  prefixes: [typeof window !== 'undefined' && window.location ? window.location.origin : ''],
  config: {
    screens: {
      Standings: {
        initialRouteName: 'StandingsList',
        screens: {
          StandingsList: `${BASE}/standings`,
          PlayerDetail: `${BASE}/standings/player/:name`,
          FrameStats: `${BASE}/standings/player/:name/frames/:playerId`,
        },
      },
      RSVP: `${BASE}/rsvp`,
      Matchups: `${BASE}/matchups`,
      Pinsino: {
        initialRouteName: 'PinsinoHome',
        screens: {
          PinsinoHome: `${BASE}/pinsino`,
          PinsinoHelp: `${BASE}/pinsino/help`,
          PinsinoLeaderboard: `${BASE}/pinsino/leaderboard`,
          Sportsbook: `${BASE}/pinsino/sportsbook`,
          LoanShark: `${BASE}/pinsino/loan-shark`,
          PlayerPinsino: `${BASE}/pinsino/player/:playerId`,
          PvP: `${BASE}/pinsino/pvp`,
          PvPBoard: `${BASE}/pinsino/pvp/board`,
          PvPCreate: `${BASE}/pinsino/pvp/create`,
          MarketMoves: `${BASE}/pinsino/market-moves`,
          BountyBoard: `${BASE}/pinsino/bounties`,
          BountyCreate: `${BASE}/pinsino/bounties/create`,
          BountyDetail: `${BASE}/pinsino/bounties/:bountyId`,
          AuctionHouse: `${BASE}/pinsino/auctions`,
          AuctionDetail: `${BASE}/pinsino/auctions/:auctionId`,
        },
      },
      More: {
        initialRouteName: 'MoreHome',
        screens: {
          MoreHome: `${BASE}/more`,
          NotificationSettings: `${BASE}/more/notifications`,
          BroadcastAdmin: `${BASE}/more/broadcasts`,
          LeagueRecords: `${BASE}/more/records`,
          HeadToHead: `${BASE}/more/head-to-head`,
          Chemistry: `${BASE}/more/chemistry`,
          History: `${BASE}/more/history`,
          TrashBoard: `${BASE}/more/trash-board`,
          Playoffs: `${BASE}/more/playoffs`,
          PlayerManagement: `${BASE}/more/player-management`,
          ProfilePictures: `${BASE}/more/profile-pictures`,
          Registration: `${BASE}/more/registration`,
          RegistrationAdmin: `${BASE}/more/registration-admin`,
          SeasonRegistration: `${BASE}/more/season-registration`,
          PinsinoAdmin: `${BASE}/more/pinsino-admin`,
          PinsinoAccounting: `${BASE}/more/pinsino-accounting`,
          AdminSportsbook: `${BASE}/more/sportsbook-admin`,
          LoanSharkAdmin: `${BASE}/more/loan-shark-admin`,
          PvPAdmin: `${BASE}/more/pvp-admin`,
          MarketMovesAdmin: `${BASE}/more/market-moves-admin`,
          BountyAdmin: `${BASE}/more/bounty-admin`,
          AuctionHouseAdmin: `${BASE}/more/auction-house-admin`,
          Archives: `${BASE}/more/archives`,
          LanetalkImportAdmin: `${BASE}/more/lanetalk-import`,
          RsvpBonusAdmin: `${BASE}/more/rsvp-bonus`,
          AppVersionAdmin: `${BASE}/more/app-version`,
        },
      },
    },
  },
}

export default function App() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_400Regular,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
    Barlow_400Regular,
    Barlow_600SemiBold,
  })

  const role = useAuthStore(s => s.role)
  const isHydrated = useAuthStore(s => s.isHydrated)

  // Live week clock: DB-driven refresh of week-derived UI on every device.
  useWeekClock(!!role)

  // Pull + apply the latest OTA update whenever the app foregrounds; while a
  // found update downloads/restarts we swap in OtaUpdatingScreen below.
  const { isApplying: otaApplying } = useOtaUpdates()

  // Update gate: block builds below app_version_config.min_supported_version
  // (they can no longer receive OTA updates). Fails open; no-op on web/dev.
  const { updateRequired, message: updateMessage } = useUpdateGate()

  useEffect(() => {
    useAuthStore.getState().hydrate()
  }, [])

  // Signed-URL avatar reads require an authenticated session, so load once signed in.
  // Prime the Pinsino notification badge here too so the tab count is live before
  // the user ever opens the (lazy-mounted) Pinsino tab; clear it on sign-out.
  useEffect(() => {
    if (role) {
      useAvatarStore.getState().load()
      useNotificationStore.getState().refresh()
      // Push Broadcasts: prompt for permission (first run) / heartbeat the
      // device token. No-op on web, simulators, and read-only sessions.
      syncPushToken()
    } else {
      useNotificationStore.getState().clear()
    }
  }, [role])

  if (!fontsLoaded || !isHydrated) return null

  if (otaApplying) {
    return (
      <SafeAreaProvider>
        <OtaUpdatingScreen />
      </SafeAreaProvider>
    )
  }

  if (updateRequired) {
    return (
      <SafeAreaProvider>
        <UpdateRequiredScreen message={updateMessage} />
      </SafeAreaProvider>
    )
  }

  if (!role) {
    return (
      <SafeAreaProvider>
        <LoginScreen />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        ref={navigationRef}
        linking={linking as any}
        onReady={flushPendingBroadcastTarget}
      >
        <BetSlipProvider>
          <View style={{ flex: 1 }}>
            <RootNavigator />
            <Toast />
          </View>
        </BetSlipProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
