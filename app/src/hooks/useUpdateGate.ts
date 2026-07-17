import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { appVersionConfig } from '../utils/supabase/db'

// The launch-time "update required" gate (app_version_config). OTA can only
// reach builds whose native fingerprint matches, so a build stranded by a
// native change silently runs stale JS forever — this gate is the one remote
// signal such a build still hears: compare the BINARY's version
// (expo-application's nativeApplicationVersion — NOT expoConfig.version,
// which travels with the JS bundle and drifts from the binary under OTA)
// against the admin-set minimum, and block the app when below it.
//
// FAILS OPEN by design: web, __DEV__, fetch errors, missing config, or an
// unreadable version all mean "don't block" — a config table must never be
// able to brick the app. Reads are authenticated-only (the repo's anon
// posture), so pre-sign-in the fetch returns nothing and the gate stays open;
// it engages on the first check after sign-in. Checks on mount and on each
// foreground (the same signal useOtaUpdates keys on), so raising the minimum
// reaches running sessions without a relaunch.
const MIN_CHECK_INTERVAL_MS = 60_000

// True when `installed` is below `min`, comparing dotted numeric segments
// ('1.0.9' < '1.0.23'; missing segments are 0). Unparseable ⇒ false (fail open).
function isBelowMinVersion(installed: string, min: string): boolean {
  const a = installed.split('.').map(Number)
  const b = min.split('.').map(Number)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

export function useUpdateGate(): { updateRequired: boolean; message: string } {
  const [updateRequired, setUpdateRequired] = useState(false)
  const [message, setMessage] = useState('')
  const lastCheckRef = useRef(0)

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web') return
    let cancelled = false

    const check = async () => {
      const now = Date.now()
      if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return
      lastCheckRef.current = now

      try {
        // Dynamic import so the web bundle never evaluates the native module
        // (the pushTokens.ts pattern).
        const Application = await import('expo-application')
        const installed = Application.nativeApplicationVersion
        if (!installed) return

        const { data } = await appVersionConfig.get()
        if (cancelled || !data) return
        setMessage(data.message)
        setUpdateRequired(isBelowMinVersion(installed, data.min_supported_version))
      } catch {
        // Offline / transient — fail open, retry on the next foreground.
      }
    }

    check()

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  return { updateRequired, message }
}
