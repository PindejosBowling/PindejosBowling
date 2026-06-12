# Silent Auctions + Item Framework — DB implementation spec (as built)

> Migrations `20260612200001`–`20260612200006`, applied 2026-06-12. Decision
> record: [AUCTION_FINDINGS.md](AUCTION_FINDINGS.md); design rationale:
> [ECONOMIC_DESIGN_SILENT_AUCTIONS.md](ECONOMIC_DESIGN_SILENT_AUCTIONS.md).
> Read this before touching any `auction_*` / `item_*` / Safety Ticket code.

## 1. The shape

House-run sealed-bid pledge auctions for economy-only items. No pins move at
bid time; at `closes_at` the cron sweep settles: highest affordable bidder
wins (first-price), insolvent leaders bounce for `min(balance, bounce_fee)`,
settlement falls through to the next bidder. Pure player→House sink. The
prize is a real inventory item (the league's first item framework).

## 2. Tables

### `item_catalog`
`key` (unique), `name`, `description`, `icon`, `effect_type`
(`bet_insurance|cosmetic|access_pass|custom` — each value promises a code hook
or admin honor), `effect_params jsonb` (per-type parameters; Safety Ticket:
`{"refund_share": 1.0}`), `activation_mode`
(`attach_to_bet|passive|admin_honored` — drives the UI affordance only),
`is_active`. **Functional columns freeze once an instance exists**
(`update_catalog_item` RAISEs); `name`/`description`/`icon` stay editable;
changed behavior = new key (`safety_ticket_v2`). No `domain`, no `charges`.

### `player_inventory_items`
**Atomic single-use rows — quantity is ALWAYS row count** (grants, pack sales,
transfers, ×N display). `player_id`, `catalog_item_id`, `season_id NOT NULL`
(season-scoped: consumption requires `current_season_id()`; a closed season's
items are inert history), `source` (`auction|merchant|admin_grant`),
`auction_id` (provenance + the reverse-settlement revocation key, `ON DELETE
SET NULL` — never CASCADE: an auction deletion must not confiscate),
`granted_at`, `consumed_at` (**the entire lifecycle**: NULL = ready).
Consume = one guarded UPDATE (owner + unconsumed + current season; rowcount =
success); restore = set back to NULL (only `cancel_bet` does this).

### `auctions`
`season_id` (**no week_id — week-agnostic**; `closes_at` is the settlement
clock), `catalog_item_id`, `description`, `quantity = 1` (CHECKed; multi-unit
is a later unlock), `status scheduled|open|settled` (**no draft, no
settled_no_winner** — no-sale derives from `winner_player_id IS NULL`),
`opens_at`, `closes_at` (**truthful history** — "Settle Now" stamps it to
`now()`), `minimum_bid`, `bounce_fee DEFAULT 50` (frozen per-row terms; no
admin knob), `bidder_count` (recounted under the lock, never ±1), winner
denorms (`winner_player_id`, `winning_bid_id`, `winning_price`), `settled_at`.

### `auction_bids`
`auction_id`, `player_id`, **`bid_amount_enc bytea`** (see §4), `status
active|won`, `submitted_at` (**the tie-break clock** — reset by every real
edit; ties go to whoever held their amount longest), `settled_at`. Partial
unique `(auction_id, player_id) WHERE status='active'`. **No ranking index**
(ciphertext; settlement decrypts-then-sorts in memory). **Settlement
hard-deletes every non-won row** (bounced included) — a rejected pledge is
destroyed; the public story is the `auctions` denorms + feed/ledger.

## 3. RLS / write posture

Reads: catalog + auctions `TO authenticated`; inventory owner-or-admin;
**`auction_bids` owner-only ALWAYS, no admin carve-out** (admins are players;
sealed means sealed — the first ownership-filtered policy in the codebase).
**Writes: NONE via RLS** — every write goes through a SECURITY DEFINER RPC
(all-RPC posture; invariants are structural). Client RPCs hold
`GRANT … TO authenticated` (admin gates in-function); internal functions
(`open_auction_internal`, `settle_auction_internal`, `sweep_auctions`,
encrypt/decrypt helpers) hold **no grants** — deny-by-default is their security.

## 4. Bid-amount encryption (anti-peeking)

`pgp_sym_encrypt` with the Vault secret **`auction_bid_amount_key`** (created
manually at push time via `vault.create_secret` — the value exists in no file,
no migration, no snapshot). Randomized per row (equal pledges ≠ equal
ciphertexts). Exactly two decode paths: `settle_auction_internal` (ranking)
and `my_bid_amount(p_auction_id)` (the caller's own row, for tap-to-reveal).
`place_auction_bid` validates the in-flight plaintext and encrypts before
INSERT; plaintext never lands in tables, payloads, logs, or probe captures.
**Threat model**: prevents casual peeking by admin-players running queries; a
DB superuser can ultimately extract the key — accepted risk, by decision.

## 5. Money + the archive engine

- `pin_ledger.auction_id` is the feature's **exactly-one root ref** (§4
  ref-column policy); types `auction_purchase`, `auction_check_bounce`.
  All pairs via `pin_ledger_double_entry(...)`, which gained a trailing
  defaulted `p_auction_id` (10-arg signature).
- **Week stamp**: settlement stamps the season's open week (the `take_loan`
  convention) so weekly accounting books outcomes to the week they occurred.
- **Archive independence**: `unarchive_week`'s pin delete carries
  `AND pl.auction_id IS NULL` — the archive engine NEVER reverses auction
  money (closes the sweep-vs-archive race). The only reversal is
  `reverse_settled_auction`, by root ref, per the §4 reversal rule.
- Zero-fee bounces are **ledger-silent, feed-loud**: no pair when
  `LEAST(balance, bounce_fee) = 0`, but the bounce event still publishes.

## 6. RPC surface

| RPC | Grant | Behavior |
|---|---|---|
| `create_catalog_item` / `update_catalog_item` | auth | Admin; update carries the functional-immutability guard |
| `grant_inventory_item(player, key, qty=1)` | auth | Admin; inserts N atomic rows (`admin_grant`, current season) |
| `create_auction(key, desc, min_bid, opens, closes)` | auth | Admin; active catalog only; lands `scheduled` (or opens immediately via the internal path) |
| `update_auction(id, …)` | auth | Admin; **scheduled only** — metadata frozen once open |
| `open_auction_now(id)` | auth | Admin; stamps `opens_at = now()` + the one opening path (publishes `auction_opened`) |
| `place_auction_bid(id, amount)` | auth | Owner upsert under the auction lock; `now() < closes_at` authoritative; `>= minimum_bid`, `<= pin_balance()`; **no-op edits skip** (tie-break clock preserved); recounts `bidder_count`; no ledger, no feed |
| `cancel_auction_bid(id)` | auth | Owner hard delete pre-close; recounts |
| `my_bid_amount(id)` | auth | Decrypts the caller's own active bid (NULL if none) |
| `settle_auction(id)` | auth | Admin **Settle Now** = stamp `closes_at = now()` under the lock → the internal path (truthful history; no override param exists) |
| `settle_auction_internal(id)` | — | The one settlement path (cron + wrapper): idempotent; `status='open' AND closes_at <= now()` only; decrypt+rank (amount DESC, submitted_at ASC); winner → purchase pair + inventory grant + denorms + `won`; insolvent → bounce + continue; then `settled` + **delete non-won bids** + publish `auction_won` / `auction_no_sale` (payload snapshots `bidder_count`/`bounce_count` for the all-bounce copy) |
| `sweep_auctions()` | — | pg_cron, per-minute (`sweep_auctions_every_minute`): open phase + settle phase, **each auction in its own `BEGIN…EXCEPTION` sub-block** (poisoned auction → `RAISE WARNING` in `cron.job_run_details`, retries every tick, never blocks the others) |
| `cancel_auction(id)` | auth | Admin, pre-settlement: hard delete (RAISEs if ledger rows exist — they can't) |
| `reverse_settled_auction(id)` | auth | Admin: revoke the granted item by its `auction_id` FK (**RAISE if consumed**), delete ledger by root ref, delete the auction — as if it never happened |

Lock ordering everywhere: **the auction row first** (`FOR UPDATE`) — bid,
cancel, and settle serialize on one lock.

## 7. Safety Ticket hooks (the one wired effect)

- `place_house_bet(..., p_insurance_item_id uuid DEFAULT NULL)` (4-arg):
  validates catalog `effect_type='bet_insurance'` + `activation_mode=
  'attach_to_bet'` (**no `is_active` check** — retirement stops grants, never
  confiscates), consumes via the guarded UPDATE, stamps
  `bets.insurance_item_id` (one column = one ticket per bet; parlays/specials
  allowed). **Spent at placement, win or lose — pushes included.**
- `finalize_bets_for_market`, **lost branch only**: NOT-EXISTS-guarded
  House-funded refund of `floor(stake × refund_share)` (from catalog
  `effect_params`), bet-linked + week-stamped → captured/reversed by the
  archive engine exactly like other bet money. Covers O/U, moneyline, and
  LaneTalk props (all funnel here). Force-voids pay only `bet_refund`.
- `cancel_bet`: restores the item (`consumed_at = NULL`) before erasing the
  bet — the only sanctioned un-spend.

## 8. Verification

[probe-auctions.sql](../../supabase/verify/probe-auctions.sql) (in
`run-all-probes.sh`): sweep-open, no-op/edit/cancel bids, ciphertext-at-rest,
bounce(40)→win(110) settlement, idempotent re-settle, foreign/consumed ticket
rejections, insured-loss refund + double-refund guard, reverse blocked-while-
consumed then zero-residue. The auction admin RPCs are in
`probe-admin-guards.sql`. Requires the Vault secret + the live
`safety_ticket` catalog row.
