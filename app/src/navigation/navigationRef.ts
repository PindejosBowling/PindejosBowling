// Module-level navigation ref, for navigating from outside the React tree —
// today that's exactly one caller: the push-notification tap handler
// (utils/pushTokens.ts) deep-linking into a broadcast's landing page.
//
// A tap can arrive before the navigator mounts (cold start from a killed app),
// so an unready navigation is stashed and flushed by App.tsx's onReady.

import { createNavigationContainerRef, CommonActions } from '@react-navigation/native'
import { getBroadcastTarget } from '../utils/broadcastTargets'

export const navigationRef = createNavigationContainerRef()

let pendingTargetKey: string | null = null

function navigateTo(key: string) {
  const target = getBroadcastTarget(key)
  console.log('[navigationRef] broadcast target:', key, target ? `→ ${target.tab}/${target.screen ?? ''}` : '(unknown key)')
  if (!target) return // unknown key (older build / retired target) — just open the app
  navigationRef.dispatch(
    CommonActions.navigate({
      name: target.tab,
      params: target.screen ? { screen: target.screen } : undefined,
    }),
  )
}

/** Deep-link to a broadcast target by catalog key; queues until the navigator
 *  is ready. Unknown keys are a silent no-op. */
export function openBroadcastTarget(key: string) {
  if (navigationRef.isReady()) {
    navigateTo(key)
  } else {
    pendingTargetKey = key // latest tap wins
  }
}

/** Called from NavigationContainer's onReady. */
export function flushPendingBroadcastTarget() {
  if (!pendingTargetKey) return
  const key = pendingTargetKey
  pendingTargetKey = null
  navigateTo(key)
}
