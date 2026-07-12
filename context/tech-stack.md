# Tech Stack & Backend

## Project Overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. The sole backend is a Supabase Postgres database accessed via typed query objects in `src/utils/supabase/db.ts`.

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
| GitHub Pages (web) | every merge to main (`deploy.yml` build+deploy jobs) | the read-only web app |
| **EAS Update (OTA)** | every merge to main (`deploy.yml` `ota-update` job) | **JS + assets only**, to installed iOS builds whose runtime matches; picked up over two launches (download, then apply) |
| TestFlight binary | `testflight.yml` — cron every ~3 days + manual dispatch | the full native app; bumps the patch version (which IS the update runtime, `runtimeVersion.policy = "appVersion"`) |

**The rule:** JS-only changes just merge — OTA delivers them. A **native change** (new native module, config-plugin change, `app.json` native config, SDK bump) MUST go out as a TestFlight build — trigger `testflight.yml` manually rather than waiting for the cron, and be aware the OTA job will still publish JS that older binaries with the same version could pull; guard new native-module calls behind dynamic imports / availability checks (the `pushTokens.ts` pattern) so that window is harmless.

---

## Backend / Data Layer

All data reads and writes go through Supabase via the typed query objects in `src/utils/supabase/db.ts`.

**Files:**

| File | Purpose |
|---|---|
| [src/utils/supabase/client.ts](src/utils/supabase/client.ts) | `createClient<Database>()` — import `supabase` from here for raw queries |
| [src/utils/supabase/database.types.ts](src/utils/supabase/database.types.ts) | Auto-generated Postgres types: `Database`, `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>` |
| [src/utils/supabase/db.ts](src/utils/supabase/db.ts) | Typed query objects, one per table — **always use these over raw client calls** |

The client is configured via Expo environment variables that are set in `.env.local` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_API_KEY`) and uses AsyncStorage for session persistence.
