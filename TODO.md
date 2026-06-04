# TODO — Move bet-line creation from team-creation → RSVP status

## Goal
Bet lines are currently created in `AdminGenerateTeamsModal` when teams are confirmed.
Rework so that **bet lines are derived from RSVP**: whenever RSVP changes, ensure lines
exist for every player who is **"in"** for the active week, and remove lines (refunding
any bets) for players who are not.

The active week = `weeks.getCurrent()` (most recent non-archived week), same as RsvpScreen/BettingScreen use today.

---

## Decisions (locked — from product discussion)

1. **Games per week = 2 by default.** Create lines for `game_number` 1 and 2 for every "in" player.
   - The league always plays 2 games. If an admin later creates a **3rd game** through the existing
     team-generation mechanism, that mechanism must **also** create the game-3 line set for the
     current "in" players (see Task 5).
2. **In → Out (or RSVP reset/removed) cancels bets.** When a player stops being "in", any bets
   placed on that player's lines for the week must be **canceled and the wagers refunded as if the
   bet was never placed** (same end state as the existing admin "cancel bet"). Then that player's
   lines for the week are deleted.
3. **Sync runs client-side on RSVP save** (`RsvpScreen`), not a DB trigger. (Exception: the
   privileged delete/refund step must go through a `SECURITY DEFINER` RPC — see Task 1/RLS note.)
4. **Line value = `Math.floor(avg) + 0.5`.** Default `avg` = the player's **current-season** average.
   Admins can later change a line's value to other sources (league avg, previous-season, all-time)
   **only while no bets have been placed on that line** (see Task 6).

---

## Key facts the implementer needs

### Schema / data (`supabase/migrations/20260604174814_betting_feature.sql`)
- `bet_lines`: `UNIQUE (week_id, player_id, game_number)`; `line numeric(5,1)`;
  **`is_open` DEFAULT `true`** (lines are bettable as soon as created); `week_id`/`player_id` FKs `ON DELETE CASCADE`.
- `placed_bets.bet_line_id` → `ON DELETE CASCADE`. `pin_ledger.placed_bet_id` → `ON DELETE SET NULL`.
- Balance = `SUM(pin_ledger.amount)` for a player+season. Removing the `bet_placed` (`-wager`) row
  restores the wager automatically. "Cancel as if never placed" = delete **all** ledger rows for that
  `placed_bet_id` (`bet_placed` + any `bet_won`/`bet_push`), then delete the `placed_bet`.
- Anti-tanking trigger `placed_bets_no_self_under` already blocks under-on-self.

### RLS (current state — IMPORTANT)
- `bet_lines`: INSERT + UPDATE permissive (anon + authenticated). **No DELETE policy → deletes blocked for everyone (incl. admin).**
- `placed_bets` / `pin_ledger`: INSERT/UPDATE permissive; **DELETE is admin-only** (JWT `app_metadata.role='admin'`,
  migration `20260604184123_betting_delete_policies.sql`).
- RsvpScreen lets **non-admins edit their own RSVP** (`canEdit = isAdmin || playerId === myPlayerId`).
  So a non-admin going In→Out must be able to refund/delete *other people's* bets on their line →
  this **cannot** be done with direct client deletes (RLS blocks non-admins, and bet_lines has no
  delete policy at all). **Resolve with a `SECURITY DEFINER` RPC** (Task 1).
- Line **creation** (INSERT) is fine client-side for any authenticated user (permissive insert).

### Relevant code
- RSVP save: `app/src/screens/RsvpScreen.tsx` — `saveChanges()` (~L97-120, `dbRsvp.upsert`),
  `resetRSVP()` (~L122-137, `dbRsvp.removeByWeek`). Uses `weeks.getCurrent`, `rsvp.listByWeek`.
- Current line creation to REMOVE/replace: `app/src/components/AdminGenerateTeamsModal.tsx`
  `doGenerate`/confirm — `betLineRows` insert (~L289-314). Avg aggregation pattern (~L147-176).
  `buildSchedule(numTeams)` (~L35-68): 2/4/6 teams → 2 games, 3/5 teams → 3 games.
- Existing per-bet cancel reference: `app/src/screens/BettingScreen.tsx` `cancelBet()`
  (`pinLedger.removeByPlacedBet` → `placedBets.remove`; reopens line if it was the last bet on a settled line).
- Avg source data: `seasons.getCurrent()`, `scores.listBySeason(seasonId)` (archived non-fill, has
  `team_slots.player_id` + `score`), `scores.listAllArchived()`. League avg fallback = mean of player avgs.
- db.ts query objects: `app/src/utils/supabase/db.ts` — `betLines` (~L311-331: list/listByWeek/listOpenByWeek/insert/update, **no remove**),
  `placedBets.listByLine`/`remove`, `pinLedger.removeByPlacedBet`.

---

## Checklist

### 1. DB migration — privileged refund+cleanup RPC
- [ ] Create migration via CLI (`supabase migration new rsvp_bet_line_cleanup_rpc`, see AGENTS.md §12).
- [ ] Add `SECURITY DEFINER` function (set `search_path = public`) that, for a week + set of player ids,
      atomically: deletes `pin_ledger` rows for placed bets on those players' lines this week → deletes
      those `placed_bets` → deletes those `bet_lines`. Sketch:
  ```sql
  create or replace function public.cancel_bet_lines_for_players(p_week_id uuid, p_player_ids uuid[])
  returns void language plpgsql security definer set search_path = public as $$
  begin
    delete from pin_ledger pl using placed_bets pb, bet_lines bl
      where pl.placed_bet_id = pb.id and pb.bet_line_id = bl.id
        and bl.week_id = p_week_id and bl.player_id = any(p_player_ids);
    delete from placed_bets pb using bet_lines bl
      where pb.bet_line_id = bl.id
        and bl.week_id = p_week_id and bl.player_id = any(p_player_ids);
    delete from bet_lines
      where week_id = p_week_id and player_id = any(p_player_ids);
  end; $$;
  grant execute on function public.cancel_bet_lines_for_players(uuid, uuid[]) to authenticated, anon;
  ```
- [ ] Push migration (`supabase db push`). Verify with a read query.
- [ ] RISK to note in PR: this RPC is callable by any authenticated user. Acceptable for now (betting
      INSERT/UPDATE are already permissive), but consider gating to admin or adding row checks later.

### 2. db.ts additions
- [ ] `betLines.remove(id)` (used by Task 6 if admin deletes; optional for sync since RPC handles delete).
- [ ] `pinLedger.cancelBetLinesForPlayers(weekId, playerIds)` → `supabase.rpc('cancel_bet_lines_for_players', { p_week_id, p_player_ids })`.
      (Or put the rpc wrapper wherever fits; keep all Supabase access in db.ts per AGENTS.md rule #2.)

### 3. Shared avg/line helper (new file `app/src/utils/betLines.ts`)
- [ ] `lineForAvg(avg: number): number` → `Math.floor(avg) + 0.5`.
- [ ] `computeAvgById(scope: 'current' | 'previous' | 'all', seasons, ...): Promise<{ avgById: Record<string, number>; leagueAvg: number }>`
      — aggregate `scores.listBySeason`/`listAllArchived` by `team_slots.player_id` (pins/games), league
      avg = mean of player avgs (fallback ~130 if empty), exactly like `AdminGenerateTeamsModal` does today.
- [ ] Export so RsvpScreen, AdminGenerateTeamsModal, and BettingAdminScreen all reuse it (avoid divergent avg logic).

### 4. RSVP-driven sync (`app/src/screens/RsvpScreen.tsx`)
- [ ] After a successful `saveChanges()` upsert AND in `resetRSVP()` (and any other rsvp mutation),
      run a `syncBetLines(weekId)` step.
- [ ] `syncBetLines` logic:
  - Reload rsvp rows for the week; `inIds = status === 'in'`.
  - Load existing `betLines.listByWeek(weekId)`, group by player.
  - **Target game numbers**: distinct `game_number`s among existing week lines; if none yet, `[1, 2]`.
    (This makes late In-joiners match an established game set incl. game 3 after team-gen.)
  - **Create**: for each `inId` missing any target game line, insert lines with
    `line = lineForAvg(avgById[pid] ?? leagueAvg)` using **current-season** avg (Task 3, scope `'current'`).
    Use insert; rely on `UNIQUE(week_id,player_id,game_number)` / pre-filter to stay idempotent.
  - **Remove + refund**: collect player ids that have lines but are **not** in `inIds`; call
    `pinLedger.cancelBetLinesForPlayers(weekId, thosePlayerIds)` (Task 2 RPC). This refunds bets and deletes lines.
  - Reload betting-affected data as needed; surface errors via `Alert`/toast.
- [ ] Edge: a player with no current-season scores → falls back to `leagueAvg`. Confirm that's desired.
- [ ] Edge: avoid creating lines when there is no active week.

### 5. Team-generation rework (`app/src/components/AdminGenerateTeamsModal.tsx`)
- [ ] **Remove** the existing `betLineRows` block that creates all lines (~L289-314).
- [ ] After teams/games are written, derive actual game numbers from `buildSchedule(numTeams)`.
- [ ] For each **"in"** player, ensure lines exist for **every** schedule game number that doesn't already
      have a line (in practice this adds **game 3** when numTeams ∈ {3,5}; games 1-2 already exist from RSVP).
      Use `lineForAvg(currentSeasonAvg)` (Task 3) for new lines; idempotent insert.
- [ ] Confirm `teams.removeByWeek` (week wipe) does **not** delete `bet_lines` (it cascades from `teams`, and
      `bet_lines` references `weeks`, not `teams`) — so RSVP lines survive regeneration. (Verify, note in PR.)
- [ ] Remove now-dead avg-source plumbing only if it's unused elsewhere (the modal still shows team avgs; keep what teams need).

### 6. Admin line-value editing (`app/src/screens/BettingAdminScreen.tsx` + `useBettingAdminData`)
- [ ] In the admin "Bet Lines" screen, allow an admin to change a line's `line` value.
- [ ] Offer the avg sources: **current season (default)**, league avg, previous season, all-time — compute
      candidate values via `computeAvgById` (Task 3) + `lineForAvg`. Allow manual entry too (keep `.5`/no-push intent in mind).
- [ ] **Guard**: only editable when `placedBets.listByLine(line.id)` is empty (no bets yet). Disable/notify otherwise.
- [ ] Persist via `betLines.update(id, { line })`.
- [ ] Render a `<Toast />` inside any new Modal (AGENTS.md modal-toast pattern).

### 7. Docs (`AGENTS.md`)
- [ ] Update `AdminGenerateTeamsModal` description: no longer the source of base lines; only adds game-3 lines.
- [ ] Add the RSVP→bet-line behavior to the RSVP/Betting sections and the "Admin flows" list.
- [ ] Document the new RPC, `db.ts` methods, and the `betLines.ts` helper.
- [ ] Update the "Betting tables" key-distinctions paragraph (lines now created from RSVP "in", floor+0.5, 2 games default + game-3 on team gen).

### 8. Verify (no test suite — manual, `expo start` from `app/`)
- [ ] RSVP a player **in** → 2 open lines (games 1-2) appear for them in Place Bets at `floor(currentAvg)+0.5`.
- [ ] Place a bet on that player; switch them **out** → bet disappears and the bettor's balance/ledger return to pre-bet state; line gone.
- [ ] Reset RSVP → all lines removed, all bets refunded.
- [ ] Generate teams with 3 teams (3 games) → game-3 lines appear for in-players; games 1-2 unchanged (no dup, bets intact).
- [ ] Generate teams with 2/4/6 teams (2 games) → no extra lines.
- [ ] Non-admin player toggling their **own** RSVP in/out triggers create/refund correctly (RPC path works without admin role).
- [ ] Admin edits a line value before any bet (allowed) and after a bet exists (blocked).
- [ ] `npx tsc --noEmit -p tsconfig.json` clean.

---

## Open questions / risks to confirm while implementing
- RPC `cancel_bet_lines_for_players` is open to all authenticated users (matches existing permissive
  betting writes). Decide if it should be admin-gated.
- Current-season avg is sparse early in a season → many players hit the league-avg fallback. Confirm acceptable
  vs. defaulting to previous-season early on.
- Late In-joiners after team-gen: the "target game numbers from existing lines" approach gives them game 3 too —
  confirm that's wanted (vs. only games 1-2 until next regen).
- Deleting a line for an In→Out player while it has a bet is handled by refund-first via the RPC; ensure no path
  deletes `bet_lines` directly (which would cascade `placed_bets` and orphan `pin_ledger` via SET NULL → no refund).
