# Ghost in the Slip — the adversarial Sportsbook item

The league's first **adversarial / cross-player** item. A player secretly attaches a
**Ghost in the Slip** (👻) to *another* player's already-placed, still-pending sportsbook
bet. If that bet **wins**, the ghost steals the profit: the original winner is credited
only their **stake back**, and the haunter(s) take the **profit**. House-neutral (no pins
minted or burned) and odds-agnostic.

Sits in the single-use item framework (`item_catalog` / `player_inventory_items`, see
[SILENT_AUCTIONS_DB.md](SILENT_AUCTIONS_DB.md)) but **breaks the self-only `attach_to_bet`
doctrine** of the Safety Ticket / Winner's Crutch / Energy Drink, all of which attach to
*your own* bet at placement via `place_house_bet`.

As-built migration: `supabase/migrations/20260623200500_ghost_in_the_slip.sql`.
Verification: `supabase/verify/probe-ghost-in-the-slip.sql` (in the `run-all-probes.sh` suite).

## Mechanic (resolved design decisions)

| Decision | Rule |
|---|---|
| **Payout split** | On a winning haunted bet the bettor is credited **exactly `stake`** (type `bet_payout`); the **profit `payout − stake`** goes to the ghosts. House pays the same total `payout` → ledger nets to zero. The "ghost eats the profit" rule, not a fixed 50% (that was an even-odds artifact). |
| **Consumption** | Consumed on **attach**, win or lose — like every consumable. Target selection is a gamble (a parlay-of-one on the victim's bet). |
| **Loss / push / void** | Ghost gets nothing; ticket stays spent. |
| **Cancel** (`cancel_bet`, **admin-only** — players can't cancel) | Haunt dissolves; ghost's ticket **refunded** (`consumed_at = NULL`). Mirrors the existing item-restore in `cancel_bet`; the `bet_haunts` rows cascade away with the bet. |
| **Targeting** | Any **other** player's **pending** bet, single or parlay. No self-haunt (rejected in `haunt_bet`). No stake floor beyond the bet's 10-pin minimum. |
| **Multiple ghosts** | Allowed, each secret. Profit splits across **N distinct haunters**: each gets `floor(profit/N)`; the **earliest `r = profit mod N` by `attached_at`** get +1, so the bettor lands at exactly `stake`. **One haunt per (bet, haunter)** — `UNIQUE(bet_id, haunter_player_id)`; no single-player stacking. |
| **Item interactions** | Golden Ticket (loss-only) → no interaction. Winner's Crutch → resolves the win/payout first, ghost eats the salvaged profit. Energy Drink → ghost takes only the **base** profit `payout − stake`; the boost bonus still credits the **bettor** (their own item). |
| **Secrecy** | A pending haunt is visible (RLS) **only to its haunter** (and admins). It goes **public only once the target bet has `won`** — that is the reveal. A **failed** haunt (loss/push/void/cancel) stays haunter-only **forever** (no public whiffs). No pins move at attach time, so nothing leaks via the public `pin_ledger` during pending. |
| **Reveal / "notification"** | A **named** aggregate "Market Moves" feed event per haunted win (`sportsbook_haunt_hit`) lists the victim + haunters + split. This app has no push/inbox (the notification framework is pending-action **badge counts** only), so the feed event + the victim's stake-only payout *is* the notification for both parties. |

## DB layer

- **`bet_haunts`** — the link: `bet_id` (→ bets, CASCADE), `haunter_player_id`, `inventory_item_id`
  (the consumed ticket, the cancel-refund key), `season_id`, `week_id`, `attached_at`
  (drives the remainder ordering), `payout_amount` (stamped at settlement), `UNIQUE(bet_id,
  haunter_player_id)`. **RLS SELECT only**: `is_admin() OR haunter = me OR bet.status='won'`.
  No write policies — all writes via SECURITY DEFINER RPCs. (The `set_updated_at` trigger is
  auto-attached by the `enforce_audit_columns` event trigger — never `CREATE TRIGGER` it.)
- **Catalog row** `ghost_in_the_slip`: `effect_type='haunt'` (NEW), `activation_mode=
  'attach_to_foreign_bet'` (NEW), `icon='👻'`, `effect_params='{}'`. Both CHECKs extended.
- **Ledger type** `bet_haunt_steal` (NEW) — the profit credited to each ghost (bet-linked +
  week-stamped). The bettor's stake-back stays on `bet_payout` so existing balance/unarchive
  tooling is unchanged.
- **`haunt_bet(p_target_bet_id, p_item_id)`** — validates (pending, not self, item is a
  usable Ghost, not already haunted by caller), consumes the ticket, inserts the `bet_haunts`
  row. **No pin movement** here.
- **`finalize_bets_for_market`** — WON branch: if haunts exist, credit the bettor only
  `stake`, split `profit` across the ghosts (remainder to earliest), stamp `payout_amount`,
  publish one `sportsbook_haunt_hit`. `NOT EXISTS (… type='bet_haunt_steal')` guard ⇒
  re-settlement (force re-archive) is idempotent. **Archive/unarchive**: haunt credits are
  `bet_id`-linked + `week_id`-stamped → deleted on unarchive, re-derived on re-archive (no
  special-casing, unlike auctions).
- **`cancel_bet`** — restores each ghost's ticket before deleting the bet.

## App layer (`app/src`)

- **`db.ts` → `haunts`**: `listMine(playerId)` (own haunts → disable CTA), `listForBet(betId)`
  (RLS-gated reveal), `create(targetBetId, itemId)` → `haunt_bet`.
- **`SportsbookScreen`**: loads unconsumed `effect_type='haunt'` items (`ghosts`) and the
  viewer's already-haunted bet ids (`hauntedBetIds`); passes `canHaunt` to `BetDetailModal`;
  renders a **screen-level** `ConfirmActionSheet` for the haunt (kept out of the modal's RN
  Modal to avoid nested BottomSheets). Also passes `hauntedBetIds` to `ActiveBetsView`.
- **`ActiveBetsView` / `BetRow`**: a `haunted` bet (in `hauntedBetIds`) renders with a **gold
  outline** (inset chip) on the Active Bets board, so the haunter can pick out their own
  haunts — still secret to everyone else (the set is the viewer's own RLS-scoped rows).
- **`BetDetailModal`**: shows the "👻 Haunt this bet" CTA on a foreign pending bet (delegates
  the confirm to the parent via `onRequestHaunt`), an "already haunting" note, and the
  **reveal** (fetches `haunts.listForBet` for `won` bets → lists haunters + cuts).
- **`activityFeedTemplates.ts`**: `sportsbook.haunt_hit` template (highlight importance).
- **`auction.ts` / `ItemInfoSheet`**: `attach_to_foreign_bet` how-to copy; `haunt` /
  `attach_to_foreign_bet` added to the admin catalog-form chip lists.
- **`LedgerRow`**: `bet_haunt_steal` → "GHOST IN THE SLIP 👻" / "GHOST PAYOUT".

## Acquisition

Existing rails only — Silent Auction + admin grant (`grant_inventory_item(player,
'ghost_in_the_slip', n)`). No new distribution machinery.
