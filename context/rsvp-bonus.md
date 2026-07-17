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

## Missed bonuses — the admin grant path

A build that predates the split write path saves the player's own row through
the plain upsert — RSVP recorded, **no bonus, no error** (this actually
happened: a stranded pre-1.0.23 install, July 2026). The rsvp table records no
actor, so the server can't detect it; remediation is a human call. The **Missed
Bonuses** section on the same admin screen lists the active week's RSVPs with
no `rsvp_bonus` credit (proxy-entered rows appear too — the hint says only
genuine self-RSVPs qualify) with a per-row **Grant** →
`admin_grant_rsvp_bonus(player_id, week_id)` (`rsvp.adminGrantBonus`):
`SECURITY DEFINER` + `assert_admin`, requires an existing rsvp row
(`no_rsvp`), same once-per-(player,week) dedup key (`already_claimed` — a
later self-submit can never double-pay), **deliberately skips** the deadline
and `is_enabled` checks, and pays the identical `pin_ledger_double_entry`.
`pinLedger.rsvpBonusesForWeek` backs the list.

## Reset revokes bonuses

The admin **Reset** on the RSVP screen goes through `reset_rsvp_for_week(week_id)`
(`SECURITY DEFINER`, admin-guarded) — it deletes the week's `rsvp_bonus`
double-entry rows (both player + and house − sides carry `week_id`) **and** the
`rsvp` rows in one transaction. Destructive rollback by deletion, same posture as
`cancel_loan`; removing both sides keeps conservation/net-zero intact. It is
**not** a trigger on `rsvp` DELETE on purpose — the archive/unarchive engine also
deletes `rsvp` rows (N+1 teardown), so bonus reversal is scoped to the explicit
reset action, not coupled into that machinery. `rsvp.resetForWeek` in `db.ts`;
the raw `rsvp.removeByWeek` is kept but no longer used by the button.

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
  (table + seed + RLS), `20260714212000_submit_own_rsvp.sql` (the RPC),
  `20260717120000_admin_grant_rsvp_bonus.sql` (the admin missed-bonus grant).
- `db/`: `rsvp.submitOwn`, `rsvp.adminGrantBonus`,
  `rsvpBonusConfig.{getGlobal,update}`, `pinLedger.rsvpBonusForWeek` (backs the
  hide-once-claimed banner), `pinLedger.rsvpBonusesForWeek` (backs the
  missed-bonus list).
- Probe: `supabase/verify/probe-rsvp-bonus.sql` (award / dedup / past-deadline /
  disabled / double-entry net-zero / admin grant: non-admin rejected, no_rsvp,
  pays despite disabled+past-deadline, re-grant dedup). In `run-all-probes.sh`.
