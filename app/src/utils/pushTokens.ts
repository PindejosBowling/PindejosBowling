// Push-token registration — the ONLY file that touches expo-notifications.
// (context/push-broadcasts.md). The imports are dynamic and every entry point
// bails on web first, so the GitHub Pages bundle never evaluates the native
// module.
//
// iOS permission is one-shot: `undetermined` → we prompt (first authenticated
// open); `denied` → we never re-prompt (recovery is the settings screen's
// "open iOS Settings" banner). Granted → register the Expo token via the
// register_push_token RPC; called on every launch, which doubles as the
// last_registered_at staleness heartbeat.

import { Platform } from 'react-native'
import { push } from './supabase/db'
import { useAuthStore } from '../stores/authStore'
import { openBroadcastTarget } from '../navigation/navigationRef'

// The token registered this session, so sign-out can best-effort unregister
// without asking the OS again.
let sessionToken: string | null = null
let handlerInstalled = false

// Tap identifiers already routed this session. getLastNotificationResponseAsync
// (the cold-start path) returns the same response on every call, and the live
// listener may also have fired for it — dedupe so a tap navigates once.
const handledTapIds = new Set<string>()

/** Route a notification tap to its broadcast landing page (`data.route`,
 *  set by the admin composer — see utils/broadcastTargets.ts). Pushes without
 *  a route (or with a key this build doesn't know) just open the app. */
function handleNotificationTap(response: {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } }
}) {
  const id = response?.notification?.request?.identifier
  if (id) {
    if (handledTapIds.has(id)) return
    handledTapIds.add(id)
  }
  const route = response?.notification?.request?.content?.data?.route
  console.log('[pushTokens] notification tap:', id, 'route =', route ?? '(none)')
  if (typeof route === 'string') openBroadcastTarget(route)
}

async function loadModules() {
  const [Notifications, Device, Constants] = await Promise.all([
    import('expo-notifications'),
    import('expo-device'),
    import('expo-constants'),
  ])
  return { Notifications, Device, Constants: Constants.default }
}

/** Current OS-level permission, for the settings screen's banner.
 *  'unavailable' = web/simulator (no push possible on this target). */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  if (Platform.OS === 'web') return 'unavailable'
  const { Notifications, Device } = await loadModules()
  if (!Device.isDevice) return 'unavailable'
  const { status } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return 'granted'
  if (status === 'undetermined') return 'undetermined'
  return 'denied'
}

/** Prompt (when undetermined), fetch the Expo token, and upsert it via RPC.
 *  Safe to call on every launch; every failure path is a silent no-op — push
 *  is never worth blocking app startup over. */
export async function syncPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') return
    const { isReadOnly, playerId } = useAuthStore.getState()
    if (isReadOnly || !playerId) return

    const { Notifications, Device, Constants } = await loadModules()
    if (!Device.isDevice) return

    // Foreground presentation: show the banner even while the app is open.
    if (!handlerInstalled) {
      handlerInstalled = true
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      })

      // Tap → deep link. The listener covers foreground/background taps; the
      // last-response probe covers a cold start from a killed app, where the
      // tap happened before this listener existed. openBroadcastTarget queues
      // internally if the navigator isn't mounted yet.
      Notifications.addNotificationResponseReceivedListener(handleNotificationTap)
      console.log('[pushTokens] tap listener installed')
      const last = await Notifications.getLastNotificationResponseAsync()
      if (last) handleNotificationTap(last)
    }

    let { status } = await Notifications.getPermissionsAsync()
    if (status === 'undetermined') {
      ;({ status } = await Notifications.requestPermissionsAsync())
    }
    if (status !== 'granted') return // denied = fully opted out at the OS level

    const projectId: string | undefined =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    if (!token) return

    const platform = Platform.OS === 'android' ? 'android' : 'ios'
    const { error } = await push.registerToken(token, platform)
    if (!error) sessionToken = token
  } catch (e) {
    console.warn('[pushTokens] sync failed:', e)
  }
}

/** Best-effort: forget this device's token on sign-out. */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'web' || !sessionToken) return
    await push.unregisterToken(sessionToken)
    sessionToken = null
  } catch (e) {
    console.warn('[pushTokens] unregister failed:', e)
  }
}
