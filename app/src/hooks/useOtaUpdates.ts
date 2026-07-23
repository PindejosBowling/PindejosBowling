import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Updates from 'expo-updates'

// Pulls and applies the latest OTA (EAS Update) bundle on foreground.
//
// The app is provisioned for EAS Update (updates.url + runtimeVersion in
// app.json), but Expo only *checks* at cold start (checkAutomatically defaults
// to ON_LOAD) and a fetched bundle only goes live on the NEXT launch. So a
// session that's already running never picks up a published update until the
// user fully kills and relaunches — the "only applies on manual reload"
// problem. The signal we actually want is "the user just came back to the
// app": foreground return is a natural break, so on every AppState 'active'
// transition we check → fetch → reloadAsync().
//
// The routine no-update check stays silent, but once an update is actually
// found `isApplying` flips true for the fetch + reload window — App.tsx swaps
// the navigator for OtaUpdatingScreen so the reload reads as a deliberate
// update instead of an unexplained flash-and-reset. A failed fetch flips it
// back and the session continues on the old bundle.
//
// Mount ONCE at app root. Runs independent of auth (updates should apply
// regardless of sign-in state), self-guarding on the two environments where
// OTA doesn't apply:
//   - __DEV__: checkForUpdateAsync() throws in dev / Expo Go.
//   - !Updates.isEnabled: web builds, simulators without an embedded update,
//     and any build with updates disabled.
// A short throttle avoids a check-storm from rapid background/foreground
// toggling. Any error (offline, transient) is swallowed — we just try again on
// the next foreground.
const MIN_CHECK_INTERVAL_MS = 60_000

export function useOtaUpdates() {
  const lastCheckRef = useRef(0)
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    let cancelled = false

    const checkAndApply = async () => {
      const now = Date.now()
      if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return
      lastCheckRef.current = now

      try {
        const result = await Updates.checkForUpdateAsync()
        if (cancelled || !result.isAvailable) return
        setIsApplying(true)
        await Updates.fetchUpdateAsync()
        if (cancelled) return
        await Updates.reloadAsync()
      } catch {
        // Offline / transient — retry on the next foreground.
        if (!cancelled) setIsApplying(false)
      }
    }

    // Catch-up for a session that started before an update was published.
    checkAndApply()

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndApply()
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  return { isApplying }
}
