# TODO — DB Security & RLS (Audit §4)

> From the 2026-06-11 database-layer audit of [supabase/schema.sql](supabase/schema.sql).
> Companion docs: [TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md),
> [TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md),
> [TODO_DB_PERFORMANCE.md](TODO_DB_PERFORMANCE.md).
>
> **Item 1 is a confirmed directive** (2026-06-11): anon's only capability should
> be invoking `is_registered_player` for the pre-login phone check. It is also
> independent of everything else — do it first.

Workflow per [context/agent-rules.md](context/agent-rules.md) §12. Policy-only
migrations don't change the types; item 4 does.

---

## 1. Anon lockdown — `is_registered_player` is the only anon surface

Today anon has `USING (true)` SELECT on **19 tables** — the entire economy
(every balance, bet, loan, debt, contract, bounty) is dumpable with the anon key,
while `players` itself is authenticated-only. The app's only pre-login DB call is
`supabase.rpc('is_registered_player', …)` ([db.ts:63](app/src/utils/supabase/db.ts#L63)),
and that function is `SECURITY DEFINER`, so it needs **no table access** — anon
needs nothing but EXECUTE on it.

### Migration — `anon_lockdown`
1. **Drop every anon policy** (with RLS enabled and no policy, anon gets zero
   rows — no GRANT changes needed):
   - `"anon can read"` on: `bet_legs`, `bet_markets`, `bet_selections`, `bets`,
     `bounty_hunter_stakes`, `bounty_payouts`, `bounty_post`,
     `bounty_settlements`, `custom_lines`, `loan_ledger`, `loan_products`,
     `loans`, `pin_ledger`, `pvp_challenge_offers`, `pvp_challenges`,
     `pvp_ledger` (`bet_offers`/`bet_matches` already gone — dropped 2026-06-12
     by `drop_deferred_peer_layer`)
   - `"anon can read public published"` on `activity_feed_events`
2. **Revoke anon EXECUTE on every RPC except the allowlist.** Postgres grants
   EXECUTE to PUBLIC by default, so anon can currently *call* `place_house_bet`,
   `take_loan`, etc. (they only fail because no player resolves from `auth.uid()`).
   Make that structural:
   ```sql
   DO $$
   DECLARE f record;
   BEGIN
     FOR f IN
       SELECT p.oid::regprocedure AS sig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname <> 'is_registered_player'
     LOOP
       EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f.sig);
     END LOOP;
   END $$;
   -- keep the one allowlisted entry point:
   GRANT EXECUTE ON FUNCTION public.is_registered_player(text) TO anon;
   -- and stop future functions from re-opening the hole:
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
   ```
   (Trigger/hook functions are unaffected — they don't run under anon. The
   `custom_access_token` hook runs as `supabase_auth_admin`.)

### Verification
- With the anon key (no session), via `curl` against PostgREST:
  - `GET /rest/v1/pin_ledger?select=id&limit=1` → `[]` (or 401/permission error)
  - same for `bets`, `loans`, `pvp_challenges`, `activity_feed_events`
  - `POST /rest/v1/rpc/is_registered_player` with a known phone → `true`
  - `POST /rest/v1/rpc/place_house_bet` → permission denied (not a player-link error)
- App: log out → login screen phone check works; log in → all tabs load
  (authenticated policies untouched).

### Docs
- Note the anon posture in [supabase/AUTH.md](supabase/AUTH.md): *anon may execute
  exactly one function; all table reads require `authenticated`.*

---

## 2. `is_admin()` policy dedup + fix `registrations` per-row `auth.jwt()`

~80 policies repeat the literal JWT-claim expression; the four `registrations`
policies are the only ones calling **bare** `auth.jwt()` (re-evaluated per row —
the initplan optimization needs the `(SELECT …)` wrapper).

Depends on: `is_admin()` from
[TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md) §1
(`SECURITY DEFINER`, `STABLE`, `SET search_path TO ''`, returns
`((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'`). Policies need the
caller to execute it: `GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;`.

### Migration — `rls_is_admin_dedup`
1. For every table, `DROP POLICY` + `CREATE POLICY` replacing the JWT expression
   with `(SELECT public.is_admin())`. Generate the DDL from the live catalog
   rather than hand-typing 80 statements (read-only query to emit the statements,
   then paste into the migration):
   ```sql
   SELECT format('DROP POLICY %I ON %I; CREATE POLICY %I ON %I AS PERMISSIVE FOR %s TO authenticated USING (...) ...', …)
   FROM pg_policies WHERE schemaname='public' AND qual LIKE '%app_metadata%';
   ```
2. Rewrite the `registrations_*` policies with `(SELECT public.is_admin())` /
   `(SELECT auth.uid())` wrappers (fixes the per-row call as a side effect).
3. Keep semantics identical — this migration must not change who can do what.
   Diff the before/after `pg_policies` dump to prove it.

### Verification
- As admin in-app: archive/settle/edit flows work.
- As a non-admin player: RSVP, bet, loan, PvP, board post — all still work;
  admin-only writes still rejected.
- `grep -c "app_metadata" supabase/schema.sql` (regenerated) ≈ 1 (the function).

---

## 3. Document the `is_registered_player` phone oracle (accepted trade-off)

The function lets anyone with the anon key confirm whether a phone number is in
the league — inherent to the pre-login UX ("is this phone registered?"). After
item 1 it is the *entire* anon attack surface, which is the right shape; we accept
the oracle.

### Task (docs only)
- Add to [supabase/AUTH.md](supabase/AUTH.md): the function exists, why it's
  SECURITY DEFINER, that it's the sole anon-callable function, and that the
  enumeration trade-off is accepted (league of ~dozens of known members; numbers
  are not secret within the league). Revisit only if the app ever opens
  registration to strangers.

---

## 4. `players.name`: DEFAULT → `GENERATED ALWAYS … STORED` (stale-data bug)

The current `DEFAULT CASE WHEN last_name = '' THEN first_name ELSE first_name || ' ' || last_name END`
computes **only at insert** — editing a player's first/last name leaves `name`
stale unless the app remembers to rewrite it. Postgres can't convert a defaulted
column to generated in place; recreate it.

### Migration — `players_name_generated`
```sql
ALTER TABLE public.players DROP COLUMN name;
ALTER TABLE public.players ADD COLUMN name text GENERATED ALWAYS AS (
  CASE WHEN last_name = '' THEN first_name
       ELSE first_name || ' ' || last_name END
) STORED;
```
Pre-checks (read-only):
- No view/index/policy depends on `name` (none in the snapshot today — re-verify).
- Find any app write paths that INSERT/UPDATE `name` explicitly — they will now
  error (`cannot insert a non-DEFAULT value into column "name"`). Grep `db.ts` and
  admin player-edit screens; remove `name` from those payloads in the same PR.

### Verification
- Edit a player's last name in the admin UI → `name` updates everywhere
  (standings, pickers) without an app-side write.
- Regenerate types (the column becomes read-only in `database.types.ts` — typed
  under `Row` but absent from `Insert`/`Update`, which is exactly the protection
  we want at compile time).

---

## Done when
- [ ] Anon: one callable function, zero readable rows (curl-verified)
- [ ] All admin policies route through `(SELECT public.is_admin())`; registrations
      wrapped; behavior diff clean
- [ ] AUTH.md documents the anon posture + phone-oracle trade-off
- [ ] `players.name` is generated; app no longer writes it
- [ ] Snapshot + types regenerated
