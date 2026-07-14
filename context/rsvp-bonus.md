# RSVP Self-Submit Bonus

A "thank you from the House" that pays a player a one-time, configurable pin bonus
(default **50**) for **personally** RSVPing their own row for the week — but only
before a configurable weekly deadline (default **6:00pm on the bowl night**,
evaluated in **America/New_York**). The goal is to drive early self-service RSVPs
so attendance/betting-line data firms up sooner.

## The rule

- **Personal only.** The bonus pays only when a player submits their *own* RSVP.
  An admin/captain RSVPing *on behalf of another player* never earns that player a
  bonus. The `rsvp` table records no actor, so this can't be reconstructed after
  the fact — the distinction lives entirely in **which write path** was taken.
- **Any response.** Both `in` and `out` earn it — the point is to get a response.
- **Once per (player, week).** Toggling In↔Out or re-saving never re-pays.
- **Before the deadline.** `now() <= (weeks.bowled_at + deadline_time)` in the
  configured timezone. `bowled_at NULL` ⇒ deadline unknown ⇒ allowed.

## The two write paths (this is the whole design)

The RSVP screen ([app/src/screens/RsvpScreen.tsx](../app/src/screens/RsvpScreen.tsx))
stages changes then **splits the batch** in `saveChanges`:

| Rows | Path | Bonus? |
|---|---|---|
| the caller's **own** row (`player_id === myPlayerId`) | `rsvp.submitOwn` → `submit_own_rsvp` RPC | **yes**, if eligible |
| **other** players' rows (admin/proxy) | `rsvp.upsert` (plain table upsert) | never |

`submit_own_rsvp` is `SECURITY DEFINER` and resolves the player from `auth.uid()`,
so the bonus can't be forged or paid on someone else's row. It writes the rsvp row
**and** (if eligible) the bonus in one transaction, then returns
`{awarded, amount, reason}` (`reason ∈ ok | already_claimed | past_deadline | disabled`)
so the client can toast on award. The bonus is a house-funded **double-entry**
credit via `pin_ledger_double_entry` with `type='rsvp_bonus'`, `week_id` = the
RSVP'd week (the dedup key). See [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md).

## Config

`rsvp_bonus_config` (feature-owned config table, `season_id NULL = global default`,
mirroring `loan_products`). Columns: `is_enabled`, `bonus_amount`, `deadline_time`,
`timezone`, `updated_by`. RLS: authenticated read (admin editor + player banner),
admin-only writes. Resolution: current-season row if present, else the global row
(v1 only ever seeds/edits the global row).

Admin editor: **More → RSVP**
([app/src/screens/RsvpBonusAdminScreen.tsx](../app/src/screens/RsvpBonusAdminScreen.tsx),
route `RsvpBonusAdmin`), edits the global row via `rsvpBonusConfig.update`.

### Game night (active week's `bowled_at`)

The same admin screen also edits the **active week's official game night**
(`weeks.bowled_at`) via `weeks.update` — the date the bonus deadline is anchored
to (and what LaneTalk imports match against). `bowled_at` is otherwise derived at
week creation from the season schedule (consecutive Mondays; see
[weeks_derive_bowled_at](../supabase/migrations/20260714170000_weeks_derive_bowled_at.sql)) —
this control is a manual override for the active week only, with its date picker
defaulting/quick-setting to the immediate coming Monday (`helpers.comingMonday`).
The week-creation derivation is unchanged.

Player-facing: a deadline banner on the RSVP screen (display-only; the RPC is
authoritative) shown while enabled, unclaimed, and before the deadline.

## Files

- Migrations: `20260714210000_rsvp_bonus_ledger_type.sql` (adds `rsvp_bonus` to the
  `pin_ledger_type_check` vocabulary), `20260714211000_rsvp_bonus_config.sql`
  (table + seed + RLS), `20260714212000_submit_own_rsvp.sql` (the RPC).
- `db.ts`: `rsvp.submitOwn`, `rsvpBonusConfig.{getGlobal,update}`,
  `pinLedger.rsvpBonusForWeek` (backs the hide-once-claimed banner).
- Probe: `supabase/verify/probe-rsvp-bonus.sql` (award / dedup / past-deadline /
  disabled / double-entry net-zero). In `run-all-probes.sh`.
