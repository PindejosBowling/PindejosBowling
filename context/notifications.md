# Pinsino Notification Framework

A small, registry-driven framework for surfacing **pending-action counts** in the Pinsino section:
per-tile badges on the hub ([PinsinoScreen](../app/src/screens/PinsinoScreen.tsx)) and an aggregate
badge on the **Pinsino** button in the main bottom-tab bar.

## Pieces

| File | Role |
|---|---|
| [`app/src/utils/notifications.ts`](../app/src/utils/notifications.ts) | The **source registry** (`NOTIFICATION_SOURCES`) + pure selectors `totalCount` / `countForRoute` |
| [`app/src/stores/notificationStore.ts`](../app/src/stores/notificationStore.ts) | Zustand store holding `counts` keyed by source; `refresh()` / `clear()` |
| [`app/src/navigation/RootNavigator.tsx`](../app/src/navigation/RootNavigator.tsx) | Reads `totalCount` → sets `tabBarBadge` on the Pinsino tab |
| [`app/src/screens/PinsinoScreen.tsx`](../app/src/screens/PinsinoScreen.tsx) | Reads `countForRoute` per tile; calls `refresh()` on focus |
| [`app/App.tsx`](../app/App.tsx) | Primes `refresh()` on auth; `clear()` on sign-out |

## A notification source

Each source is a self-contained object — it owns how to fetch its own count and which hub tile it
badges:

```ts
export interface NotificationSource {
  key: string                          // stable id, e.g. 'pvp'
  route: keyof PinsinoStackParamList   // the hub tile this badge sits on
  fetchCount: (playerId: string, seasonId: string) => Promise<number>
}
```

Sources live in the `NOTIFICATION_SOURCES` array. Live sources: **`pvp`** (contracts
awaiting the player's response, reusing `isReceivedForPlayer` from
[`usePvpData`](../app/src/hooks/usePvpData.ts)) and **`auction`** (open auctions where
the player has **no active bid** — bid existence comes from the owner-only
`auction_bids` RLS, so the query naturally returns only the viewer's rows).

## Data flow

1. **Prime** — on auth, `App.tsx` calls `useNotificationStore.getState().refresh()`. This runs even
   before the (lazy-mounted) Pinsino tab is opened, so the tab badge is correct from the landing view.
2. **Fan out** — `refresh()` reads the signed-in `playerId` + current season, then calls every source's
   `fetchCount` in parallel and stores the results as `counts: Record<sourceKey, number>`.
3. **Hub badges** — each tile renders `countForRoute(counts, tile.route)` (sums every source mapped to
   that route). No per-route `if`.
4. **Tab badge** — `RootNavigator` renders `totalCount(counts)` (sum of all sources) as the Pinsino
   `tabBarBadge`, capped at `99+`.
5. **Stay fresh** — `PinsinoScreen` calls `refresh()` on focus, so badges are correct on return to the
   hub. But focus alone is **not** sufficient: a subpage that mutates the data behind a badge (e.g.
   responding to a PvP contract) leaves the tile badge **and** the live tab-bar badge stale until the hub
   re-focuses. Therefore any screen that performs such a mutation **MUST** call
   `useNotificationStore.getState().refresh()` directly after it — do not rely on the hub's focus refresh.

   The clean way is to refresh at the same chokepoint that reloads the screen's own data, so the two never
   drift. In `PvPScreen` the inbox reload and the badge refresh are bundled into one `reloadAll` that every
   focus, pull-to-refresh, and post-mutation `onChanged` callback runs:

   ```ts
   const reloadAll = useCallback(
     () => Promise.all([reload(), useNotificationStore.getState().refresh()]).then(() => {}),
     [reload],
   )
   ```

## Adding a notification to a new tile

One change — append an entry to `NOTIFICATION_SOURCES`:

```ts
{
  key: 'loan',
  route: 'LoanShark',
  fetchCount: async (playerId, seasonId) => {
    const { data } = await loans.listByPlayer(playerId)
    return (data ?? []).some(l => l.status === 'active') ? 1 : 0
  },
}
```

That's it: the store fans out over it automatically, the matching hub tile badges via `countForRoute`,
and the tab total includes it. Keep `fetchCount` cheap (it runs on every `refresh`) and return `0` when
nothing is pending. Multiple sources may share a `route` — their counts sum on that tile.
