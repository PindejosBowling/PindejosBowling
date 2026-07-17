# Tech Stack & Backend

## Project Overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. The sole backend is a Supabase Postgres database accessed via typed query objects in `src/utils/supabase/db/` (per-domain modules behind a barrel).

---

## Tech Stack

| Layer | Library / Version |
|---|---|
| Runtime | React Native 0.85 via Expo SDK 56 |
| UI framework | React 19.2 |
| Language | TypeScript (strict enough; some `any` in data layer) |
| State | Zustand 5 |
| Navigation | React Navigation 7 (bottom tabs + native stack) |
| Storage (prefs) | `@react-native-async-storage/async-storage` |
| Charts | `react-native-gifted-charts` |
| Fonts | Barlow + Barlow Condensed via `@expo-google-fonts` |
| Gradients | `react-native-linear-gradient` |
| Database | Supabase (Postgres) via `@supabase/supabase-js` |

Run with `expo start` from `app/`. Use `--ios`, `--android`, or `--web` flags.

## Shipping changes to devices

Three delivery channels, each with its own trigger:

| Channel | Trigger | Ships |
|---|---|---|
| GitHub Pages (web) | every merge to main (`deploy.yml`) | the read-only web app |
| **EAS Update (OTA)** | every merge to main (`ota-update.yml`) | **JS + assets only**, to installed iOS builds whose runtime matches; picked up over two launches (download, then apply) |
| TestFlight binary | `testflight.yml` — cron every ~3 days + manual dispatch | the full native app; bumps the patch version (marketing only — the update runtime is the native **fingerprint**, `runtimeVersion.policy = "fingerprint"`) |

**Fingerprint determinism:** the `production` build profile sets `EXPO_USE_PRECOMPILED_MODULES=0` (`eas.json`). Without it, the EAS builder downloads precompiled xcframeworks INTO `node_modules` (RNScreens, RNSVG, RNCAsyncStorage, safe-area-context) during pod install, changing those packages' fingerprint hashes after CI computed them — the builder's mismatch check then fails the build ("Runtime version calculated on local machine not equal…"). Building those modules from source keeps `node_modules` pristine so the CI (ubuntu) fingerprint and the builder's recomputation agree; the mismatch check stays active as a guard. (`EAS_SKIP_AUTO_FINGERPRINT=1` does NOT fix this — it only skips eas-cli's local computation, not the builder-side check.) Verified locally: the fingerprint is otherwise identical across macOS/linux and unaffected by prebuild + pod install.

**The rule:** JS-only changes just merge — OTA delivers them **to every installed build whose native fingerprint matches**, across marketing versions (a version bump alone no longer strands older installs — the July 2026 lesson: under the old `appVersion` policy the 1.0.22→1.0.23 bump froze 1.0.22 devices on pre-RSVP-bonus JS). A **native change** (new native module, config-plugin change, `app.json` native config, SDK bump) changes the fingerprint and MUST go out as a TestFlight build — trigger `testflight.yml` manually rather than waiting for the cron. Until a device installs that build it receives no further OTA updates; the DB-backed **update-required gate** (`app_version_config` + `useUpdateGate`, min version editable at More → App Version) is how those stranded installs get told to update. Still guard new native-module calls behind dynamic imports / availability checks (the `pushTokens.ts` pattern) for the dev/simulator paths.

---

## Backend / Data Layer

All data reads and writes go through Supabase via the typed query objects in `src/utils/supabase/db/`.

**Files:**

| File | Purpose |
|---|---|
| [src/utils/supabase/client.ts](src/utils/supabase/client.ts) | `createClient<Database>()` — import `supabase` from here for raw queries |
| [src/utils/supabase/database.types.ts](src/utils/supabase/database.types.ts) | Auto-generated Postgres types: `Database`, `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>` |
| [src/utils/supabase/db/](src/utils/supabase/db/) | Typed query objects, one per table (four domain modules behind a barrel) — **always use these over raw client calls** |

The client is configured via Expo environment variables that are set in `.env.local` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_API_KEY`) and uses AsyncStorage for session persistence.
