# Page Creation Blueprint

A complete reference for adding a new screen to PindejosBowling — from the database layer up through the UI.

---

## Mental Model

Every screen follows the same four-layer stack:

```
Database (Supabase)
    ↓  migration file → db.ts query method
Hook  (src/hooks/useXxxData.ts)
    ↓  rawData + reload
Screen (src/screens/XxxScreen.tsx)
    ↓  useMemo → display data
Navigation (MoreStackNavigator + MoreHomeScreen tile)
```

Work bottom-up: get the data right before building the UI.

---

## 1. Database Layer

### Schema changes must use migration files

**Never alter the schema by running SQL directly.** Every change must live in `supabase/migrations/` so it is version-controlled and reproducible.

```bash
# Always create the file this way — never invent the filename
SUPABASE_ACCESS_TOKEN=<token> \
  supabase migration new <descriptive_name> \
  --workdir /Users/garrett/Code/PindejosBowling
```

This creates `supabase/migrations/<timestamp>_<descriptive_name>.sql`. Write your SQL into that file, then push:

```bash
SUPABASE_ACCESS_TOKEN=<token> \
  supabase db push --linked \
  --workdir /Users/garrett/Code/PindejosBowling
```

Load `SUPABASE_ACCESS_TOKEN` from `app/.env.local`. Project ref: `lyihsvxraurjghjqxaau`.

### Backfilling and generated columns

When splitting or transforming an existing column, use a migration that:
1. Adds the new column(s) with a temporary `DEFAULT` to allow backfill
2. Runs an `UPDATE` to populate them from existing data
3. Drops the temporary `DEFAULT`
4. Drops or replaces the old column

If downstream code reads the old column name extensively, re-add it as a **generated stored column** so existing reads continue to work without any app changes:

```sql
ALTER TABLE public.players ADD COLUMN name TEXT GENERATED ALWAYS AS (
  CASE WHEN last_name = '' THEN first_name
       ELSE first_name || ' ' || last_name
  END
) STORED;
```

Generated columns are readable but cannot be included in `INSERT`/`UPDATE` payloads.

### Regenerate TypeScript types after every schema change

```bash
SUPABASE_ACCESS_TOKEN=<token> \
  supabase gen types typescript --linked \
  --workdir /Users/garrett/Code/PindejosBowling \
  --schema public \
  > /tmp/database.types.new.ts \
  && mv /tmp/database.types.new.ts \
       app/src/utils/supabase/database.types.ts
```

**Always write to a temp file first.** A failed `>` redirect will clobber the existing types file. If the file is accidentally emptied, restore it with:

```bash
git show HEAD:app/src/utils/supabase/database.types.ts \
  > app/src/utils/supabase/database.types.ts
```

The `supabase gen types` command requires the project's legacy API keys to be enabled. If it fails with "Legacy API keys are disabled", re-enable them in the Supabase dashboard, run the command, then disable them again.

### Regenerate the schema snapshot after every schema change

`supabase/schema.sql` is a generated, single-file snapshot of the current `public` schema (tables, constraints, indexes, RLS policies, functions, triggers). It is the source of truth for *current* DDL — agents read it instead of crawling the append-only `migrations/` log, which is full of since-superseded definitions. As the last step of every push, regenerate it (no Docker required):

```bash
./supabase/refresh-schema-snapshot.sh
```

Never hand-edit `supabase/schema.sql` — it is overwritten on every run.

---

## 2. Data Access Layer (`db.ts`)

All queries go through the typed query objects in `src/utils/supabase/db.ts`. Never make raw `supabase.from(...)` calls in a screen or hook — add a method to `db.ts` instead.

### Adding a method for a new table

```ts
export const myTable = {
  list: () =>
    supabase.from('my_table').select('*').order('created_at', { ascending: false }),
  getById: (id: string) =>
    supabase.from('my_table').select('*').eq('id', id).single(),
  insert: (data: TablesInsert<'my_table'>) =>
    supabase.from('my_table').insert(data),
  update: (id: string, data: TablesUpdate<'my_table'>) =>
    supabase.from('my_table').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('my_table').delete().eq('id', id),
}
```

For screens that need joined data (e.g. scores joined to weeks and players), add a dedicated read method with `.select('*, related_table(*)')` rather than making multiple round-trips.

---

## 3. Hook (`src/hooks/useXxxData.ts`)

Each screen has exactly one hook. The hook owns all Supabase calls; the screen owns all derived-data logic.

### Canonical hook shape

```ts
import { useState, useCallback, useEffect } from 'react'
import { myTable } from '../utils/supabase/db'

export function useMyScreenData() {
  const [loading, setLoading] = useState(true)
  const [rawItems, setRawItems] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await myTable.list()
      setRawItems(data ?? [])
    } catch (e) {
      console.error('useMyScreenData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawItems, reload: load }
}
```

Rules:
- **No memoization inside the hook.** `useMemo` is the screen's job.
- Return `{ loading, rawXxx, reload }` at minimum.
- Export any pure compute functions from the same file when the screen needs them.

---

## 4. Screen (`src/screens/XxxScreen.tsx`)

### Skeleton

```tsx
import { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import { useMyScreenData } from '../hooks/useMyScreenData'
import { useRefresh } from '../hooks/useRefresh'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function MyScreen() {
  const navigation = useNavigation<Nav>()
  const { loading, rawItems, reload } = useMyScreenData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const displayItems = useMemo(
    () => rawItems.map(/* transform */),
    [rawItems],
  )

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My Screen" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
        }
      >
        {/* content */}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
})
```

### Key rules

- **Always wrap `LoadingView` check** before the main render so the header doesn't flash in.
- **Derive display data with `useMemo`**, never inline in JSX. Compute functions scan full arrays on every call.
- **Pull-to-refresh on every scrollable screen** via `useRefresh(reload)` + `RefreshControl`.
- **`ScreenHeader`** for all inner (non-tab-root) screens. Tab roots use `AppHeader`.
- **`SafeAreaView` with `edges={['top']}`** — do not add `bottom` here; handle it via `paddingBottom` in content or a fixed bar's inset.
- **Always check with the user to determine which role (player or admin) should have access to the page or its contents**

### Theme reference (import from `src/theme.ts`)

| Token | Value | Use |
|---|---|---|
| `colors.bg` | `#0a0a0c` | Page background |
| `colors.surface` | `#131316` | Cards |
| `colors.surface2` | `#1c1c21` | Raised elements, inputs |
| `colors.accent` | `#e8ff47` | Primary CTA, highlights |
| `colors.text` | `#f0f0f0` | Body text |
| `colors.muted` | `#7a7a85` | Secondary text, labels |
| `colors.muted2` | `#55555e` | Disabled / tertiary |
| `colors.border` | `rgba(255,255,255,0.08)` | Subtle dividers |
| `colors.border2` | `rgba(255,255,255,0.14)` | Card borders, inputs |
| `colors.success` | `#4ade80` | Positive state |
| `colors.danger` | `#ff4f6d` | Destructive / error |
| `radius.card` | `18` | Large cards |
| `radius.cardMd` | `14` | Medium cards |
| `radius.cardSm` | `12` | Buttons, inputs |
| `fonts.barlowCondensed` | — | Labels, headings, stats |
| `fonts.barlow` | — | Body text |

### Write operations (admin screens)

For screens that mutate data:
- Call `players.update()` / `players.insert()` directly in the screen (not in the hook)
- Show feedback with `useUiStore().showToast(msg, 'success' | 'error')`
- Call `reload()` after every successful write to sync with the database
- Use a local `saving` boolean to disable buttons and show a spinner during the request

---

## 5. Navigation

### Step 1 — Add the route to `src/navigation/types.ts`

```ts
export type MoreStackParamList = {
  // ... existing routes
  MyScreen: undefined          // no params
  // or:
  MyScreen: { id: string }     // with params
}
```

### Step 2 — Register in `src/navigation/MoreStackNavigator.tsx`

```tsx
import MyScreen from '../screens/MyScreen'

// inside <Stack.Navigator>:
<Stack.Screen name="MyScreen" component={MyScreen} options={{ title: 'My Screen' }} />
```

### Step 3 — Add a tile in `src/screens/MoreHomeScreen.tsx`

Tiles go in either `leagueToolsTiles` (read-only views) or `adminTiles` (write operations):

```ts
{ icon: '🔧', label: 'My Screen', onPress: () => navigation.navigate('MyScreen') }
```

### Navigating to `PlayerDetail` from outside the Standings tab

`PlayerDetail` lives in a different stack. Use the cross-tab pattern:

```tsx
(navigation as any).navigate('Standings', { screen: 'PlayerDetail', params: { name } })
```

---

## 6. End-to-End Checklist

- [ ] Migration file created with `supabase migration new` (never manually named)
- [ ] Migration pushed with `supabase db push --linked`
- [ ] TypeScript types regenerated and written via temp file
- [ ] Schema snapshot regenerated (`./supabase/refresh-schema-snapshot.sh`)
- [ ] New query methods added to `db.ts` (no raw client calls in hooks/screens)
- [ ] Hook created in `src/hooks/` returning `{ loading, rawXxx, reload }`
- [ ] Screen uses `useMemo` for all derived data
- [ ] `useRefresh(reload)` wired to `RefreshControl`
- [ ] `LoadingView` shown while `loading === true`
- [ ] `ScreenHeader` with `onBack` for inner screens
- [ ] Route added to `MoreStackParamList` in `types.ts`
- [ ] Screen registered in `MoreStackNavigator.tsx`
- [ ] Tile added to `MoreHomeScreen.tsx` in the correct section
- [ ] Write operations call `reload()` after success and show a toast
