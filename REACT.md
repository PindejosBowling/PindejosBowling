# REACT.md — Pindejos Bowling: React Native Migration Plan

This document is the authoritative specification for migrating the Pindejos Bowling app from Vue 3 (web) to React Native (iOS). It is written for agentic implementation: every section specifies exact packages, file paths, mapping decisions, and known complexity factors. Agents should read this document in full before beginning any implementation work.

---

> **HARD CONSTRAINT — READ BEFORE TOUCHING ANYTHING:**
> The React Native implementation lives entirely within this existing repository under the `native/` subdirectory. The Vue 3 app (everything outside `native/`) is the production app and must remain fully operational throughout this migration.
>
> **Agents MUST NOT modify any existing file in this repository.** Only create new files. If a file already exists, skip it or pick a non-colliding name. The Vue and React Native apps must be runnable in parallel:
> - Vue app: `npm run dev` (from repo root, unchanged)
> - React Native app: `cd native && npx expo start`

---

## 1. Project Overview

### Source project
- **Location:** `/Users/garrett/Code/PindejosBowling` (the current repo)
- **Stack:** Vue 3 + Vite + Pinia + Vue Router (hash mode), deployed to GitHub Pages
- **Backend:** Google Apps Script endpoint (HTTPS REST, no auth)
- **~4,250 lines of source** across 39 files

### Target project
- **Framework:** React Native via Expo (managed workflow)
- **Platform target:** iOS App Store (primary), Android (incidental benefit)
- **Location:** `native/` subdirectory within this existing repo (i.e. `/Users/garrett/Code/PindejosBowling/native/`)
- **Goal:** Fully native iOS UI that is functionally identical to the current web app

### What this migration is NOT
- This is not a Capacitor/WebView wrapper. All UI must use native React Native components.
- This is not a progressive port. The Vue project remains the production app until the React Native app is feature-complete and submitted.
- This is not a new repository. All React Native code lives in `native/` inside the existing repo. The root-level `package.json`, `vite.config.js`, `index.html`, `src/`, and `public/` are Vue-owned and must never be modified.

---

## 2. Reusable Code (Copy Directly)

The following files from the Vue project contain **zero Vue imports and zero DOM dependencies**. They are plain JavaScript and should be copied verbatim into the React Native project under `native/src/utils/` and `native/src/api.js`. **Do not modify the originals in `src/`.** No changes required to the copied files except import paths.

| Source file | Lines | Notes |
|---|---|---|
| `src/utils/data.js` | 658 | All bowling math, standings, profiles, H2H, chemistry, records derivation |
| `src/utils/helpers.js` | 76 | `initials()`, `timeAgo()`, `escapeHtml()`, `isPresent()`, `combinations()`, `spreadAndML()` |
| `src/utils/constants.js` | 34 | `SC` (stats column indices), `AW` (active week column indices) |
| `src/api.js` | 24 | `apiGet()`, `apiPost()` — uses `fetch`, which is available in RN |

**Important:** `src/api.js` contains the live Google Apps Script URL hardcoded. Do not modify it. The `fetch` API works identically in React Native — no changes needed.

---

## 3. New Project Setup

### 3a. Initialize Expo project

Run from the repo root. The `native` argument tells `create-expo-app` to create the project inside a `native/` subdirectory, which keeps all Expo files isolated from the Vue project.

```bash
npx create-expo-app native --template blank-typescript
```

All subsequent commands in this section are run from `native/` unless otherwise noted. Use TypeScript from the start. All new files should be `.tsx` (components) or `.ts` (logic/stores).

### 3b. Required dependencies

Install all of the following before beginning implementation:

```bash
# Navigation
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context

# State management
npm install zustand

# Storage (replaces localStorage)
npx expo install @react-native-async-storage/async-storage

# Chart (replaces Chart.js)
npx expo install react-native-gifted-charts react-native-linear-gradient react-native-svg

# Fonts (Barlow Condensed + Barlow)
npx expo install expo-font @expo-google-fonts/barlow-condensed @expo-google-fonts/barlow

# Gestures (required by react-navigation)
npx expo install react-native-gesture-handler
```

### 3c. Project directory structure

All React Native files live under `native/` at the repo root. **Do not create any files outside `native/`.** The directory tree below shows the intended layout within `native/`:

```
native/                         ← created by create-expo-app; all RN files live here
  app.json                      — Expo config (bundle ID, app name, icons)
  App.tsx                       — Root: font loading, NavigationContainer, store init
  src/
    api.js                      — Copied verbatim from ../src/api.js (Vue source)
    theme.ts                    — Design tokens (colors, typography, spacing)
    utils/
      data.js                   — Copied verbatim from ../src/utils/data.js
      helpers.js                — Copied verbatim from ../src/utils/helpers.js
      constants.js              — Copied verbatim from ../src/utils/constants.js
    stores/
      dataStore.ts              — Zustand: server data + loadAll()
      uiStore.ts                — Zustand: per-screen filter/UI state
      pendingStore.ts           — Zustand: unsaved RSVP + score changes
      prefsStore.ts             — Zustand: AsyncStorage-backed preferences
    navigation/
      RootNavigator.tsx         — Bottom tab navigator (5 tabs)
      MoreStackNavigator.tsx    — Stack navigator for all /more/* screens
      types.ts                  — MoreStackParamList type definition
    screens/
      MatchupsScreen.tsx
      RsvpScreen.tsx
      StandingsScreen.tsx
      HistoryScreen.tsx
      MoreHomeScreen.tsx
      PlayerListScreen.tsx
      PlayerDetailScreen.tsx
      LeagueRecordsScreen.tsx
      HeadToHeadScreen.tsx
      ChemistryScreen.tsx
      SeasonHistoryScreen.tsx
      TrashBoardScreen.tsx
      GenerateTeamsScreen.tsx
      PlayoffsScreen.tsx
    components/
      AppHeader.tsx
      PlayerScoreRow.tsx
      OddsBlock.tsx
      HistoricalTeamBlock.tsx
      ConfirmBar.tsx
      Toast.tsx
      LoadingView.tsx
      PlayerPickerModal.tsx
      AdminAddPlayerModal.tsx
      AdminArchiveModal.tsx
      AdminEndSeasonModal.tsx
```

**Collision avoidance:** `create-expo-app` generates `native/package.json`, `native/app.json`, `native/tsconfig.json`, `native/babel.config.js`, etc. None of these clash with the Vue project's root-level equivalents because they are inside `native/`. Do not copy or merge any of these into the repo root.

---

## 4. Design Tokens

All CSS custom properties from `styles.css` must be replicated as a TypeScript constants file at `native/src/theme.ts`. This file will be imported everywhere inside the React Native project instead of CSS class names.

```typescript
// src/theme.ts
export const colors = {
  bg:        '#0a0a0c',
  surface:   '#131316',
  surface2:  '#1c1c21',
  surface3:  '#25252b',
  border:    'rgba(255,255,255,0.08)',
  border2:   'rgba(255,255,255,0.14)',
  accent:    '#e8ff47',
  accentDim: 'rgba(232,255,71,0.12)',
  accent2:   '#ff4f6d',
  accent3:   '#4fc3ff',
  gold:      '#fbbf24',
  text:      '#f0f0f0',
  muted:     '#7a7a85',
  muted2:    '#55555e',
  success:   '#4ade80',
  danger:    '#ff4f6d',
}

export const fonts = {
  barlow:          'Barlow_400Regular',
  barlowMedium:    'Barlow_500Medium',
  barlowSemiBold:  'Barlow_600SemiBold',
  barlowCondensed: 'BarlowCondensed_700Bold',
  barlowCondensedHeavy: 'BarlowCondensed_900Black',
}

export const radius = {
  card:   18,
  cardMd: 14,
  cardSm: 12,
  icon:   10,
}
```

### Typography rules

- Body text: `fonts.barlow`, `colors.text`
- Labels / section headers / badges: `fonts.barlowCondensed`, `colors.muted`, uppercase, `letterSpacing: 1.5`
- Logo "PIN": `fonts.barlowCondensedHeavy`, `colors.accent`
- Logo "DEJOS": `fonts.barlowCondensedHeavy`, `colors.text`
- Stat values / large numbers: `fonts.barlowCondensed`, large size

---

## 5. State Management (Pinia → Zustand)

Zustand is the direct replacement for Pinia. The API is nearly identical for simple stores. All four Pinia stores map 1:1 to Zustand stores.

### 5a. Data store (`src/stores/dataStore.ts`)

Maps directly from `src/stores/data.js`. Replace `ref()` with Zustand `set()` patterns.

```typescript
import { create } from 'zustand'
import { apiGet } from '../api.js'

interface DataStore {
  current: any | null
  active: any | null
  roster: any | null
  rsvp: any | null
  stats: any | null
  board: any | null
  history: any | null
  champions: any | null
  generated: any | null
  settings: any | null
  loading: boolean
  error: string | null
  loadAll: () => Promise<void>
}

export const useDataStore = create<DataStore>((set) => ({
  current: null, active: null, roster: null, rsvp: null,
  stats: null, board: null, history: null, champions: null,
  generated: null, settings: null, loading: false, error: null,
  loadAll: async () => {
    set({ loading: true, error: null })
    try {
      const all = await apiGet('getAll')
      set({
        current: all.currentWeek, active: all.activeWeek,
        roster: all.roster, rsvp: all.rsvp, stats: all.stats,
        board: all.board, history: all.history, champions: all.champions,
        generated: all.generated, settings: all.settings,
      })
    } catch (e: any) {
      set({ error: e.message })
    } finally {
      set({ loading: false })
    }
  },
}))
```

### 5b. UI store (`src/stores/uiStore.ts`)

Maps from `src/stores/ui.js`. All fields are transient (not persisted). Replace `showToast` with a global toast mechanism (see Section 9c).

```typescript
export const useUiStore = create<UiStore>((set, get) => ({
  matchupsView: 'scores',
  expandedWeek: null,
  playerLogMode: 'bowled',
  oddsRevealed: false,
  standingsSeason: null,
  playerSeason: null,
  histSeason: null,
  histWeek: null,
  recordsSeason: 'all',
  chemMode: 'pairs',
  chemExpanded: false,
  h2hP1: null,
  h2hP2: null,
  set: (partial) => set(partial),
}))
```

### 5c. Pending store (`src/stores/pendingStore.ts`)

Maps directly from `src/stores/pending.js`. All fields are plain objects/primitives — no Vue reactivity needed.

### 5d. Prefs store (`src/stores/prefsStore.ts`)

Maps from `src/stores/prefs.js`. Replace `localStorage` with `AsyncStorage`. Because AsyncStorage is async, initialize with a `hydrate()` function called in `App.tsx` before rendering.

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'

export const usePrefsStore = create<PrefsStore>((set) => ({
  myName: '',
  avgDisplay: 'last-played',
  setMyName: async (val: string) => {
    set({ myName: val })
    await AsyncStorage.setItem('pb_myname', val)
  },
  setAvgDisplay: async (val: string) => {
    set({ avgDisplay: val })
    await AsyncStorage.setItem('pb_avgdisplay', val)
  },
  hydrate: async () => {
    const myName     = await AsyncStorage.getItem('pb_myname') ?? ''
    const avgDisplay = await AsyncStorage.getItem('pb_avgdisplay') ?? 'last-played'
    set({ myName, avgDisplay })
  },
}))
```

---

## 6. Navigation Architecture

### 6a. Structure

The Vue Router hierarchy maps to React Navigation as follows:

```
RootNavigator (Bottom Tabs)
├── Tab: Matchups        → MatchupsScreen
├── Tab: RSVP            → RsvpScreen
├── Tab: Standings       → StandingsScreen
├── Tab: History         → HistoryScreen
└── Tab: More            → MoreStackNavigator (Stack)
    ├── Screen: MoreHome        → MoreHomeScreen
    ├── Screen: PlayerList      → PlayerListScreen
    ├── Screen: PlayerDetail    → PlayerDetailScreen  (param: name: string)
    ├── Screen: LeagueRecords   → LeagueRecordsScreen
    ├── Screen: HeadToHead      → HeadToHeadScreen
    ├── Screen: Chemistry       → ChemistryScreen
    ├── Screen: SeasonHistory   → SeasonHistoryScreen
    ├── Screen: TrashBoard      → TrashBoardScreen
    ├── Screen: GenerateTeams   → GenerateTeamsScreen
    └── Screen: Playoffs        → PlayoffsScreen
```

### 6b. Bottom tab navigator

Use `@react-navigation/bottom-tabs`. Configure the tab bar with:
- `tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border }`
- `tabBarActiveTintColor: colors.accent`
- `tabBarInactiveTintColor: colors.muted`
- All 5 tabs use emoji icons (🎳 RSVP 📊 🗓️ ⋯) matching the current `AppNav.vue`
- Tab labels: "This Week", "RSVP", "Standings", "Matches", "More"
- `tabBarShowLabel: true`
- `headerShown: false` on all tab screens (custom `AppHeader` component handles the header)

### 6c. More stack navigator

Use `@react-navigation/native-stack`. Configure:
- `headerShown: false` on all screens (each screen renders its own back button row as in the Vue app)
- `screenOptions: { contentStyle: { backgroundColor: colors.bg } }`

### 6d. Screen params type definition

```typescript
// src/navigation/types.ts
export type MoreStackParamList = {
  MoreHome: undefined
  PlayerList: undefined
  PlayerDetail: { name: string }
  LeagueRecords: undefined
  HeadToHead: undefined
  Chemistry: undefined
  SeasonHistory: undefined
  TrashBoard: undefined
  GenerateTeams: undefined
  Playoffs: undefined
}
```

### 6e. Navigation pattern for in-screen buttons

```typescript
// Equivalent of: router.push({ name: 'player-detail', params: { name } })
const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>()
navigation.navigate('PlayerDetail', { name })

// Equivalent of: router.push('/more')
navigation.navigate('MoreHome')

// Back button (replaces router.push('/more/players'))
navigation.goBack()
```

---

## 7. App Entry Point (`App.tsx`)

`App.tsx` is the equivalent of `src/main.js` + `src/App.vue`. It must:

1. Load Expo fonts (Barlow + Barlow Condensed variants)
2. Call `usePrefsStore.getState().hydrate()` to restore AsyncStorage prefs
3. Call `useDataStore.getState().loadAll()` to fetch initial data
4. Wrap everything in `NavigationContainer` with the `RootNavigator`
5. Render the global `Toast` component (overlay)

```typescript
export default function App() {
  const [fontsLoaded] = useFonts({ BarlowCondensed_700Bold, BarlowCondensed_900Black, Barlow_400Regular, ... })

  useEffect(() => {
    usePrefsStore.getState().hydrate()
    useDataStore.getState().loadAll()
  }, [])

  if (!fontsLoaded) return null

  return (
    <NavigationContainer>
      <SafeAreaProvider>
        <RootNavigator />
        <Toast />
      </SafeAreaProvider>
    </NavigationContainer>
  )
}
```

---

## 8. Screen-by-Screen Implementation

Each screen below maps from its Vue counterpart. Complexity ratings: **Low** (direct translation), **Medium** (some new RN patterns), **High** (significant new logic or UI).

---

### 8a. MatchupsScreen — **High**

**Source:** `src/components/ActiveMatchupsPanel.vue` (322 lines) + `src/views/MatchupsView.vue`

This is the most complex screen. It handles both the live scoring mode and the expected (pre-game) mode.

**Key implementation notes:**

- Use `ScrollView` as the root container with `contentContainerStyle={{ paddingBottom: 100 }}` to clear the floating confirm bar.
- The `<select>` for view mode ("Live" / "Expected") becomes a `Picker` from `@react-native-picker/picker` or a row of `TouchableOpacity` toggle buttons. Prefer toggle buttons — they match the existing visual style better and avoid the native picker sheet.
- The view-mode toggle and avg-source selector are stored in `uiStore.matchupsView` and `prefsStore.avgDisplay` respectively — same as the Vue app.
- The `buildPairings()` function in `ActiveMatchupsPanel.vue:228–243` is pure logic — copy it directly into `MatchupsScreen.tsx` unchanged.
- `getTotal()`, `aWins()`, `bWins()`, `expectedTotal()` are also pure logic — copy them directly.
- The floating confirm bar (unsaved scores) is rendered as a `View` with `position: 'absolute'`, `bottom: 0`, `left: 0`, `right: 0`. Use a `ConfirmBar` shared component (see Section 10).
- The "Archive & Advance" prompt is a `View` card rendered conditionally when `hasSavedScores` is true, with a button that opens `AdminArchiveModal`.
- The "Tonight's Lines" odds section is a conditionally rendered `View` — use a `TouchableOpacity` with the `· · ·` text to toggle `uiStore.oddsRevealed`.
- Score inputs: Each player row has a `TextInput` with `keyboardType="number-pad"`. Pending scores write to `pendingStore.pendingScores` keyed as `${teamName}|${slot}|${gameNum}` — identical to the Vue app.

**Dependencies on:**
- `PlayerScoreRow` component
- `OddsBlock` component
- `AdminArchiveModal` component
- `useDataStore`, `useUiStore`, `usePendingStore`, `usePrefsStore`
- `readActiveWeek`, `getLeagueAvg`, `effectiveAvg` from `utils/data.js`
- `apiPost` from `api.js`

---

### 8b. RsvpScreen — **Medium**

**Source:** `src/views/RsvpView.vue` (140 lines)

**Key implementation notes:**

- Root `ScrollView` with bottom padding for the floating confirm bar.
- The RSVP summary (In / Out / No Reply counts) is a horizontal `View` with three `View` cards side by side. Use `flexDirection: 'row'` and `flex: 1` on each card.
- The player list uses `FlatList` with each item being a row of initials box + player name + In/Out buttons. `FlatList` is preferred over `map()` inside `ScrollView` for long lists.
- `stageRSVP()` logic is copied verbatim from the Vue source.
- `window.confirm()` in `resetRSVP()` does not exist in React Native. Replace with `Alert.alert('Reset RSVPs?', 'This will clear all RSVPs for the upcoming week.', [{ text: 'Cancel' }, { text: 'Reset', onPress: doReset }])`.
- The floating confirm bar is the shared `ConfirmBar` component.

**Dependencies on:**
- `useDataStore`, `usePendingStore`
- `initials` from `utils/helpers.js`
- `apiPost` from `api.js`

---

### 8c. StandingsScreen — **Low**

**Source:** `src/views/StandingsView.vue` (67 lines)

**Key implementation notes:**

- Season filter: a horizontal `ScrollView` of `TouchableOpacity` pill buttons is preferred over a `Picker` — more iOS-native for a small set of options.
- The standings list uses `FlatList`. Each row is tappable and navigates to `PlayerDetail`.
- The crown emoji (👑) for past champions renders inline with the player name as a `Text` element.
- `aggregateStandings()` from `utils/data.js` is used directly — no changes.

**Dependencies on:**
- `useDataStore`, `useUiStore`
- `aggregateStandings`, `getSeasons`, `getDefaultViewSeason`, `isChampion` from `utils/data.js`

---

### 8d. HistoryScreen — **Medium**

**Source:** `src/views/HistoryView.vue` (120 lines)

**Key implementation notes:**

- Two pickers: season and week. Use `Picker` components or a segmented-control style toggle row.
- The matchup cards use `HistoricalTeamBlock` component.
- Data is loaded via `getMatchupsForWeek()` from `utils/data.js`.

**Dependencies on:**
- `useDataStore`, `useUiStore`
- `getMatchupsForWeek`, `getSeasons`, `getWeeksForSeason` from `utils/data.js`
- `HistoricalTeamBlock` component

---

### 8e. MoreHomeScreen — **Low**

**Source:** `src/views/MoreHomeView.vue` (64 lines)

**Key implementation notes:**

- The tile grid: use a `View` with `flexDirection: 'row'`, `flexWrap: 'wrap'`. Each tile is a `TouchableOpacity` with fixed width (approximately `(screenWidth - 48) / 3`).
- "Add Player" and "End Season" tiles open modal sheets (`AdminAddPlayerModal`, `AdminEndSeasonModal`) rendered as React Native `Modal` components with `transparent={true}` and a dark backdrop.
- `AdminArchiveDialog` from the Vue app is triggered from `MatchupsScreen`, not `MoreHomeScreen`. Do not move it.
- The "Archive" tile in `MoreHomeView.vue` does not exist — do not add it. The archive flow is triggered from MatchupsScreen only.

**Dependencies on:**
- `AdminAddPlayerModal`, `AdminEndSeasonModal` components
- Navigation to all More sub-screens

---

### 8f. PlayerListScreen — **Low**

**Source:** `src/views/PlayerListView.vue` (61 lines)

**Key implementation notes:**

- A `TextInput` search field at the top filters the roster list. Use `useState` for the search query.
- `FlatList` for the player list. Each row navigates to `PlayerDetail`.
- Back button navigates to `MoreHome`.

---

### 8g. PlayerDetailScreen — **High**

**Source:** `src/views/PlayerDetailView.vue` (370 lines)

This is the most complex read-only screen.

**Key implementation notes:**

- Player name comes from `route.params.name` in Vue → `route.params.name` in React Navigation (`useRoute<RouteProp<MoreStackParamList, 'PlayerDetail'>>().params.name`).
- The stat tiles grid: use `flexDirection: 'row'`, `flexWrap: 'wrap'`, each tile `width: '50%'`.
- **Chart replacement:** Replace `Chart.js` with `react-native-gifted-charts`. Use the `LineChart` component. The data format differs — transform `profile.games` into `[{ value: score, label: 'S1W1.G1' }, ...]`. Configure colors to match the existing theme (`#e8ff47` for the score line, `rgba(255,79,109,0.5)` dashed for the avg line).
  - `react-native-gifted-charts` does not support dashed reference lines natively. Render the avg line as a separate `LineChart` with `color='rgba(255,79,109,0.5)'` overlaid using `position: 'absolute'`, or use the `referenceLine` prop if available.
  - Wrap the chart in a `View` with a fixed height (e.g., 200) and `overflow: 'hidden'`.
- The game log uses `FlatList`. Each row is tappable to expand (uses `uiStore.expandedWeek`).
- The expanded week matchup detail renders inline below the tapped row using a `View` that is conditionally rendered — same pattern as Vue's `v-if`.
- Season filter: same pill/toggle approach as StandingsScreen.
- `watchEffect` for chart creation → use `useEffect` with `[profile, chartData]` as dependencies.
- Back button: `navigation.navigate('PlayerList')` (not `goBack()`) to match the Vue behavior of always going back to the player list, not the previous screen in the stack.

**Dependencies on:**
- `useDataStore`, `useUiStore`
- `getPlayerProfile`, `getPersonalRecords`, `isChampion`, `getSeasons`, `getMatchupsForWeek` from `utils/data.js`
- `initials`, `isPresent` from `utils/helpers.js`
- `SC` from `utils/constants.js`

---

### 8h. LeagueRecordsScreen — **Medium**

**Source:** `src/views/LeagueRecordsView.vue` (151 lines)

**Key implementation notes:**

- Season filter (same pill approach).
- Record cards are static `View` elements — no interaction.
- Uses `getLeagueRecords()` from `utils/data.js`.

---

### 8i. HeadToHeadScreen — **Medium**

**Source:** `src/views/HeadToHeadView.vue` (145 lines)

**Key implementation notes:**

- Two player pickers. In the web app these are `<select>` elements. In RN, use `Picker` or a modal-based player picker (a `Modal` containing a `FlatList` of player names).
- The player picker modal pattern: tapping a player name field opens a `Modal` with a searchable `FlatList`. Selecting a name closes the modal and sets `uiStore.h2hP1` / `uiStore.h2hP2`.
- Uses `getH2H()` from `utils/data.js`.

---

### 8j. ChemistryScreen — **Medium**

**Source:** `src/views/ChemistryView.vue` (67 lines)

**Key implementation notes:**

- Toggle between "Pairs" and "Trios" mode (maps to `uiStore.chemMode`).
- Data table: use `FlatList` with rows sorted by win rate.
- Uses `getChemistry()` from `utils/data.js`.

---

### 8k. SeasonHistoryScreen — **Low**

**Source:** `src/views/SeasonHistoryView.vue` (82 lines)

**Key implementation notes:**

- Displays past season summary cards. Each card is a `View`.
- Uses `championsForSeason()` and `aggregateStandings()` from `utils/data.js`.

---

### 8l. TrashBoardScreen — **Medium**

**Source:** `src/views/TrashBoardView.vue` (67 lines)

**Key implementation notes:**

- Board posts displayed in a `FlatList`, newest first.
- Post input: a `TextInput` with `multiline={false}` and a "Post" button. The current user's name comes from `prefsStore.myName`.
- If `prefsStore.myName` is empty, show a `TextInput` to set the user's name before posting.
- Uses `apiPost('addBoardPost', { name, message })` then calls `dataStore.loadAll()`.

---

### 8m. GenerateTeamsScreen — **Medium**

**Source:** `src/views/GenerateTeamsView.vue` (259 lines)

**Key implementation notes:**

- Controls: Number of Teams, Players per Team, Avg Source, Fill Mode — all use toggle button groups (`View` + `TouchableOpacity` for each option, styled as pill toggles). State lives in `pendingStore`.
- Generated team cards: rendered from `pendingStore.genTeams`. Each team card is a `View`.
- Swap UI: `pendingStore.genSwapTarget` tracks which player is selected for swapping. Tapping a player when swap mode is active calls the swap logic.
- The generation logic in `GenerateTeamsView.vue` uses functions from `utils/data.js` — these copy directly.
- Uses `apiPost('saveGeneratedTeams', ...)` then `dataStore.loadAll()`.

---

### 8n. PlayoffsScreen — **Low**

**Source:** `src/views/PlayoffsView.vue` (60 lines)

**Key implementation notes:**

- Informational screen only. Static content with a "coming soon" message. Direct translation to `View` + `Text` elements.

---

## 9. Shared Components

### 9a. AppHeader (`src/components/AppHeader.tsx`)

**Source:** `src/components/AppHeader.vue` (40 lines)

Rendered at the top of each tab screen (not inside the stack navigator). Displays the logo and week/season badge.

```
View (horizontal row)
├── Text "🎳" (emoji logo)
├── View (logo text)
│   ├── Text "PIN" (accent color, BarlowCondensedHeavy)
│   └── Text "DEJOS" (text color, BarlowCondensedHeavy)
└── View (badge, marginLeft: 'auto')
    ├── Text weekLabel (accent, BarlowCondensed)
    └── Text "Season N" (muted, BarlowCondensed)
```

- `weekLabel` and `currentSeason` computed using `hasActiveWeek()`, `getCurrentSeason()` from `utils/data.js` and `AW` from `utils/constants.js` — same logic as the Vue component.
- Each tab screen renders `<AppHeader />` at the top of its `SafeAreaView` before its `ScrollView`.

### 9b. PlayerScoreRow (`src/components/PlayerScoreRow.tsx`)

**Source:** `src/components/PlayerScoreRow.vue` (133 lines)

Renders a single player row inside the matchup panels. Contains a `TextInput` for score entry when in live mode.

- Props: `player`, `teamName`, `gameNum`, `mode` ('scores' | 'expected'), `leagueAvg`
- In 'expected' mode: shows the player's expected score (derived from `effectiveAvg()`) — no input
- In 'scores' mode: shows a `TextInput` with `keyboardType="number-pad"`, bound to `pendingStore.pendingScores`
- Fill player rows show "(fill)" label and use league avg as their display score

### 9c. Toast (`src/components/Toast.tsx`)

**Source:** `src/components/AppToast.vue` (13 lines) + toast logic in `uiStore.js`

In React Native, toast notifications are rendered as an absolutely positioned `View` overlaid on the screen.

```typescript
// Rendered in App.tsx at the top level, above NavigationContainer is NOT possible
// Render it as the last child inside NavigationContainer:
<NavigationContainer>
  <RootNavigator />
  <Toast />   {/* position: 'absolute', bottom: 100, alignSelf: 'center' */}
</NavigationContainer>
```

- `uiStore.showToast(msg, type)` pushes a toast to `uiStore.toasts`. The `Toast` component subscribes and renders the most recent toast with an auto-dismiss `setTimeout`.
- Types: `'success'` (green), `'error'` (red/danger), `''` (neutral).

### 9d. ConfirmBar (`src/components/ConfirmBar.tsx`)

**Source:** Inline in `RsvpView.vue` and `ActiveMatchupsPanel.vue`

A floating bar docked to the bottom of the screen (above the tab bar). Used in both `RsvpScreen` and `MatchupsScreen`.

```typescript
interface ConfirmBarProps {
  message: string
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}
```

Render as a `View` with `position: 'absolute'`, `bottom: 0`, `left: 0`, `right: 0`, `backgroundColor: colors.surface2`, top border in `colors.border`. The parent `ScrollView` must have `contentContainerStyle={{ paddingBottom: 80 }}` when the bar is visible.

### 9e. LoadingView (`src/components/LoadingView.tsx`)

**Source:** Inline loading states throughout Vue views

A centered `View` with an `ActivityIndicator` and a `Text` label. Used in every screen that waits on `dataStore.loading`.

```typescript
<LoadingView label="Loading standings" />
```

### 9f. OddsBlock (`src/components/OddsBlock.tsx`)

**Source:** `src/components/OddsBlock.vue` (113 lines)

Displays spread and moneyline for a matchup. Pure display — uses `spreadAndML()` from `utils/helpers.js`.

### 9g. HistoricalTeamBlock (`src/components/HistoricalTeamBlock.tsx`)

**Source:** `src/components/HistoricalTeamBlock.vue` (44 lines)

Displays a team's players and scores for a historical matchup week. Used in `HistoryScreen`.

### 9h. Admin modals

**Source:** `src/components/AdminAddPlayerDialog.vue`, `AdminArchiveDialog.vue`, `AdminEndSeasonDialog.vue`

These become React Native `Modal` components with `transparent={true}` and a dark semi-transparent backdrop.

```typescript
<Modal visible={visible} transparent animationType="fade">
  <View style={styles.backdrop}>
    <View style={styles.sheet}>
      {/* modal content */}
    </View>
  </View>
</Modal>
```

- `backdrop`: `flex: 1`, `backgroundColor: 'rgba(0,0,0,0.7)'`, `justifyContent: 'flex-end'` (slides up from bottom) or `justifyContent: 'center'`
- `sheet`: `backgroundColor: colors.surface`, `borderRadius: 20`, `padding: 24`
- `onRequestClose` dismisses the modal (Android back button)

The `window.confirm()` pattern used in `AdminArchiveDialog.vue` for confirmations is replaced with `Alert.alert()`.

**There is no equivalent to `window.openModal(html)` in React Native.** The `modalStore` and `AppModal` patterns from the Vue app are not replicated. All dialogs in RN are proper component modals with typed props.

---

## 10. Platform-Specific Patterns

### Scrolling
- All screens use `ScrollView` or `FlatList` as root. Do not use `View` as the only root — content will not scroll.
- `FlatList` is preferred over `.map()` inside `ScrollView` for any list with more than ~10 items (player lists, standings, game log).
- `keyboardShouldPersistTaps="handled"` on `ScrollView`/`FlatList` in screens with `TextInput` (Matchups, RSVP, Board).

### Keyboard avoidance
- Wrap screens with `TextInput` in `KeyboardAvoidingView` with `behavior="padding"` on iOS.

### Safe area
- Use `SafeAreaView` from `react-native-safe-area-context` as the outermost container in each tab screen. This ensures content doesn't overlap the iOS notch or home indicator.
- The bottom tab bar is handled by `@react-navigation/bottom-tabs` automatically.

### Haptics (optional enhancement)
- `expo-haptics` can be added for button taps on destructive actions. Not required for v1.

### Pull-to-refresh
- Wrap each screen's `ScrollView` or `FlatList` in a `RefreshControl` that calls `dataStore.loadAll()`. This replaces the "no pull-to-refresh" limitation of the web app.

```typescript
<ScrollView
  refreshControl={
    <RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />
  }
>
```

---

## 11. Patterns That Don't Exist in React Native

The following Vue-specific patterns must be replaced as described:

| Vue pattern | React Native replacement |
|---|---|
| `v-if` | Ternary `condition ? <A /> : null` or logical `&&` |
| `v-for` | `.map()` or `FlatList` |
| `v-model` on input | `value={state}` + `onChangeText={setState}` |
| `computed()` | `useMemo(() => ..., [deps])` |
| `ref()` (reactive) | `useState` |
| `watch()` | `useEffect` with dependency array |
| `onMounted()` | `useEffect(() => ..., [])` |
| `watchEffect()` | `useEffect` (no explicit deps — RN doesn't auto-track) |
| `:class="{ active: x }"` | `[styles.base, x && styles.active]` in StyleSheet |
| `@click` | `onPress` on `TouchableOpacity` or `Pressable` |
| `<select>` + `@change` | `Picker` or custom toggle button group |
| `<input type="number">` | `<TextInput keyboardType="number-pad">` |
| `window.confirm()` | `Alert.alert()` |
| `localStorage` | `AsyncStorage` (async) |
| CSS variables | `theme.ts` constants |
| CSS class names | `StyleSheet.create({})` objects |
| Scoped styles | Each component defines its own `StyleSheet` |

---

## 12. App Store Configuration

### 12a. `app.json` configuration

```json
{
  "expo": {
    "name": "Pindejos Bowling",
    "slug": "pindejos-bowling",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "pindejosbowling",
    "userInterfaceStyle": "dark",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#0a0a0c"
    },
    "ios": {
      "bundleIdentifier": "com.pindejos.bowling",
      "buildNumber": "1",
      "supportsTablet": false
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0a0a0c"
      },
      "package": "com.pindejos.bowling"
    }
  }
}
```

- `userInterfaceStyle: "dark"` forces dark mode, matching the app's dark theme. This prevents the system light-mode from breaking the UI.
- `supportsTablet: false` is appropriate for a phone-only league app.
- `bundleIdentifier` must be unique on the App Store. Update `com.pindejos.bowling` if already taken.

### 12b. Required assets

| File | Dimensions | Notes |
|---|---|---|
| `assets/icon.png` | 1024×1024 | No alpha channel. Dark background (`#0a0a0c`), bowling ball or PIN/DEJOS logo. |
| `assets/splash.png` | 1284×2778 | Splash screen. Same design language as icon. |
| `assets/adaptive-icon.png` | 1024×1024 | Android only — can be identical to icon.png |

### 12c. Fonts in Expo

Expo Google Fonts packages must be registered in `App.tsx` via `useFonts()`. The following weights are used in the app:

```typescript
import {
  BarlowCondensed_400Regular,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
  BarlowCondensed_900Black,
} from '@expo-google-fonts/barlow-condensed'

import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
} from '@expo-google-fonts/barlow'
```

---

## 13. Known Complexity Notes for Agents

- **`ActiveMatchupsPanel.vue` is the highest-complexity file in the project.** It manages live score entry, pending state, team totals, win detection, expected mode, odds reveal, and the Archive prompt simultaneously. Implement it last within Phase 4 and test each sub-feature independently.

- **`PlayerDetailView.vue` chart** requires careful data transformation. The Chart.js config in the Vue source (`PlayerDetailView.vue:321–368`) documents the exact color values and dataset configuration. Replicate these visually in `react-native-gifted-charts`.

- **Admin dialogs** (`AdminArchiveDialog.vue`, `AdminAddPlayerDialog.vue`, `AdminEndSeasonDialog.vue`) all make `apiPost` calls followed by `dataStore.loadAll()`. The exact action names and payloads must match — read the Vue source before implementing.

- **H2H and Chemistry player pickers** require a custom picker UI. The `<select>` elements in the web app are not appropriate on iOS. Implement a reusable `PlayerPickerModal` component (a `Modal` with a `FlatList` of player names and a search input) and use it in both `HeadToHeadScreen` and anywhere else a player selection is needed.

- **The `LegacyMatchupsPanel`** (read-only display of `dataStore.current`, used when there is no active week) is separate from `ActiveMatchupsPanel`. Read `src/components/LegacyMatchupsPanel.vue` (276 lines) carefully — it parses a different data format from `dataStore.current` rather than `dataStore.active`.

- **`isPresent()`** (from `utils/helpers.js`) and **`hasActiveWeek()`** (from `utils/data.js`) are used in multiple screens to gate rendering. Understand these before implementing `MatchupsScreen`.

- **All API response keys** are documented by the mapping in `dataStore.ts` (Section 5a above): `all.currentWeek → current`, `all.activeWeek → active`, etc. Do not guess key names from store property names — use the mapping.

---

## 14. Progress Checklist

This checklist mirrors Section 13 (Implementation Order). Agents must check off each item as it is completed. Do not mark an item complete until the feature is verified working on a device or simulator. Work through phases sequentially — do not begin a phase until all items in the previous phase are checked.

### Phase 1: Foundation
- [x] Initialize Expo project with TypeScript template from repo root: `npx create-expo-app native --template blank-typescript`
- [x] Install all required dependencies from inside `native/` (navigation, zustand, async-storage, gifted-charts, fonts, gesture-handler)
- [x] Copy `src/api.js` → `native/src/api.js` (verbatim, do not modify the Vue source)
- [x] Copy `src/utils/data.js` → `native/src/utils/data.js` (verbatim)
- [x] Copy `src/utils/helpers.js` → `native/src/utils/helpers.js` (verbatim)
- [x] Copy `src/utils/constants.js` → `native/src/utils/constants.js` (verbatim)
- [x] Create `src/theme.ts` with all color, font, and radius tokens
- [x] Implement `src/stores/dataStore.ts` (Zustand, server data + loadAll)
- [x] Implement `src/stores/uiStore.ts` (Zustand, transient UI/filter state)
- [x] Implement `src/stores/pendingStore.ts` (Zustand, unsaved RSVP + scores + generator state)
- [x] Implement `src/stores/prefsStore.ts` (Zustand, AsyncStorage-backed myName + avgDisplay)
- [x] Implement `src/navigation/MoreStackNavigator.tsx` with all 10 screens as placeholders
- [x] Implement `src/navigation/RootNavigator.tsx` with 5 bottom tabs (placeholder screens for non-More tabs)
- [x] Implement `App.tsx` (font loading, store hydration, NavigationContainer, SafeAreaProvider, Toast placeholder)
- [X] Verify: app launches in simulator, all 5 tabs are tappable, More stack navigates forward and back between placeholder screens

### Phase 2: Data Verification
- [x] Trigger `dataStore.loadAll()` on app mount and confirm it completes without error
- [x] Render `JSON.stringify(stats)` on the Standings placeholder screen and confirm real API data appears

### Phase 3: Read-Only Screens
- [x] Implement `src/components/AppHeader.tsx` (logo row + week/season badge)
- [x] Implement `src/components/LoadingView.tsx` (ActivityIndicator + label)
- [x] Implement `StandingsScreen` (FlatList, season pill filter, champion crown, tap → PlayerDetail)
- [x] Implement `PlayerListScreen` (search TextInput, FlatList, tap → PlayerDetail)
- [x] Implement `PlayerDetailScreen` — stat tiles, personal records, game log with expand/collapse (chart deferred to Phase 6)
- [x] Implement `HistoryScreen` (season + week pickers, HistoricalTeamBlock cards)
- [x] Implement `src/components/HistoricalTeamBlock.tsx`
- [x] Implement `SeasonHistoryScreen` (past season summary cards)
- [x] Implement `LeagueRecordsScreen` (season pill filter, record cards)
- [x] Implement `ChemistryScreen` (pairs/trios toggle, win-rate FlatList)
- [x] Implement `HeadToHeadScreen` (PlayerPickerModal for two player selections, H2H stats + game log)
- [x] Implement `src/components/PlayerPickerModal.tsx` (reusable Modal + searchable FlatList — used by H2H)
- [x] Implement `PlayoffsScreen` (static informational content)
- [x] Implement `MoreHomeScreen` (tile grid navigation only — no admin modals yet)

### Phase 4: Write Screens
- [x] Implement `src/components/ConfirmBar.tsx` (floating bottom bar with Discard + Save buttons)
- [x] Implement `RsvpScreen` (player list, In/Out toggle, pending state, ConfirmBar, Alert.alert for reset)
- [x] Implement `LegacyMatchupsPanel` mode in `MatchupsScreen` (read-only display of `dataStore.current`)
- [x] Implement `ActiveMatchupsPanel` mode in `MatchupsScreen` (score TextInput, pending state, team totals, win detection, expected mode, odds reveal, ConfirmBar, Archive & Advance prompt)
- [x] Implement `src/components/PlayerScoreRow.tsx` (live score input + expected score display)
- [x] Implement `src/components/OddsBlock.tsx` (spread + moneyline display)
- [x] Implement `TrashBoardScreen` (FlatList of posts, post input, myName prompt if unset)
- [x] Implement `GenerateTeamsScreen` (controls, generate action, team cards, swap UI)

### Phase 5: Admin Modals
- [x] Implement `src/components/AdminAddPlayerModal.tsx` (Modal with name input + Add button → apiPost)
- [x] Implement `src/components/AdminEndSeasonModal.tsx` (Modal with confirmation → apiPost)
- [x] Implement `src/components/AdminArchiveModal.tsx` (Modal with confirmation → apiPost for archive & advance)
- [x] Wire `AdminAddPlayerModal` and `AdminEndSeasonModal` into `MoreHomeScreen`
- [x] Wire `AdminArchiveModal` into `MatchupsScreen` (triggered from the Archive & Advance prompt card)

### Phase 6: Polish
- [x] Implement `src/components/Toast.tsx` and wire `uiStore.showToast()` — verify success/error toasts appear on writes
- [x] Add `RefreshControl` to every `ScrollView` and `FlatList` (calls `dataStore.loadAll()`)
- [x] Add `KeyboardAvoidingView` (behavior="padding") to `MatchupsScreen`, `RsvpScreen`, `TrashBoardScreen`
- [ ] Add empty state views to all screens that can have no data (no games, no posts, no records)
- [ ] Audit all screens for correct `LoadingView` gating (`dataStore.loading || !dataStore.stats`)
- [ ] Implement score trend `LineChart` in `PlayerDetailScreen` using `react-native-gifted-charts` (colors from Section 8g)


### Phase 7: App Store
- [ ] Enroll in Apple Developer Program ($99/year) if not already enrolled
- [ ] Design app icon (1024×1024 PNG, no alpha, dark `#0a0a0c` background)
- [ ] Design splash screen (1284×2778 PNG, same design language)
- [ ] Configure `app.json` with correct `bundleIdentifier`, `version`, `buildNumber`, and asset paths
- [ ] Install and configure EAS CLI (`npm install -g eas-cli && eas login && eas build:configure`)
- [ ] Run first iOS build (`eas build --platform ios`) and resolve any build errors
- [ ] Create app record in App Store Connect (name, bundle ID, primary language)
- [ ] Write app description, keywords, and prepare at least 3 App Store screenshots (iPhone 6.7")
- [ ] Create and host a privacy policy URL
- [ ] Submit build for App Review via App Store Connect
- [ ] Address any App Review rejections and resubmit
