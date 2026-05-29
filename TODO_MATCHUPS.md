# MatchupsScreen — Supabase Migration Plan

Validation infrastructure is in place (see `scripts/`).  This file tracks the
UI implementation steps.

---

## 1. Add `scores.listBySeason` to `db.ts`

**Status: done.**

---

## 2. Create `useMatchupsData` hook

New file: `app/src/hooks/useMatchupsData.ts`

Fetches and derives everything `MatchupsScreen` needs in one place:

| Query | db.ts helper |
|---|---|
| Active week | `weeks.getActive()` |
| Team rosters | `teamSlots.listByWeek(weekId)` |
| Game pairings | `gameSchedule.listByWeek(weekId)` |
| Live scores | `scores.listByWeek(weekId)` |
| RSVPs | `rsvp.listByWeek(weekId)` |
| Season list | `seasons.list()` |
| Prev-season scores | `scores.listBySeason(prevSeasonId)` |
| Champion list | `seasonChampions.list()` |

**Returns:** `{ loading, weekId, derived, reload }`

`derived` is the same shape validated by `matchups-contract.mjs`, with three
extra fields pre-computed per player so `PlayerScoreRow` can drop its
`useDataStore` dependency:

```ts
player: {
  teamSlotId: string   // team_slots.id — used as the pending score key
  isOut: boolean       // true if player RSVPd Out this week
  isChampion: boolean  // true if player appears in season_champions
  // ...existing contract fields unchanged
}
```

---

## 3. Update `PlayerScoreRow`

File: `app/src/components/PlayerScoreRow.tsx`

- **Remove** `useDataStore` (currently reads `champions`, `rsvp`, `stats`, `settings`)
- **Remove** calls to `isChampion`, `isPlayerOut`, `getPlayerCurrentAvg`,
  `effectiveAvg` from `data.js` — these are now pre-computed by the hook
- **Read** `player.isChampion`, `player.isOut`, `player.effectiveAvg` from the
  player prop instead
- **Change pending key** from `${teamName}|${slot}|${gameNum}` →
  `${player.teamSlotId}|${gameNum}`
- **Update `PlayerScoreRowProps`** to include the three new player fields

---

## 4. Update `MatchupsScreen`

File: `app/src/screens/MatchupsScreen.tsx`

- **Replace** `useDataStore` with `useMatchupsData`
- **Replace** `useRefresh(loadActive)` with `useRefresh(reload)` from the hook
- **Update `getTotal()`** — pending key lookup changes from
  `${teamName}|${slot}|${gameNum}` to `${teamSlotId}|${gameNum}`; player
  objects now carry `teamSlotId` so the lookup can be done in the player loop
- **Replace `saveScores()`** — swap `apiPost('batchUpdateScores')` for
  `scores.upsert()`:
  ```ts
  const rows = keys.map(k => {
    const [teamSlotId, gameNum] = k.split('|')
    return { team_slot_id: teamSlotId, game_number: parseInt(gameNum), score: parseInt(pendingScores[k]) }
  })
  await scores.upsert(rows)
  ```
- **Replace `loadAll()` refresh** (called after save) with `reload()` from the hook
- **Drop** `loadAll`, `loadActive`, `stats`, `settings` from the destructure —
  none of these are used once the hook is in place

---

## 5. Validate

```sh
node scripts/validate-sb-matchups.mjs
```

Should print `PASS` once the active week data exists in Supabase.  If it
prints `FAIL`, fix the violations before considering the screen done.

---

## 6. Check off in `TODO.md`

Mark `MatchupsScreen` done.  Once all screens are migrated, `useDataStore` and
`api.js` can be deleted per the Cleanup section of `TODO.md`.
