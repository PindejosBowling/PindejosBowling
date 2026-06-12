-- Silent Auctions M2 — auctions + auction_bids, pin_ledger/bets extensions,
-- bid-amount encryption helpers (context/economy/AUCTION_FINDINGS.md §3/§5/§9/§10/§11).
--
-- Key decisions encoded here:
--   * Auctions are WEEK-AGNOSTIC entities (no week_id): closes_at is their
--     settlement clock. Their ledger pairs are week-stamped at settlement time
--     for accounting accuracy, and M3 exempts them from unarchive_week's
--     week-scoped reversal (AND pl.auction_id IS NULL) — archive/unarchive
--     never touch auction money; reversal is exclusively reverse_settled_auction.
--   * auction_bids stores player–auction–amount only; amounts are ENCRYPTED AT
--     REST (pgp_sym_encrypt, key in Supabase Vault) as anti-peeking — a DB
--     superuser can ultimately bypass, which is accepted risk. No ranking
--     index (ciphertext): settlement decrypts-then-sorts in memory.
--   * Status unions are minimal: auctions scheduled|open|settled (no draft, no
--     settled_no_winner — no-sale derives from winner_player_id IS NULL);
--     bids active|won (losers/bounced are hard-deleted at settlement).
--   * pin_ledger.auction_id is the feature's exactly-one root ref (§4 policy);
--     pin_ledger_double_entry gains a trailing defaulted p_auction_id.
--
-- ⚠️ MANUAL STEP AT PUSH TIME (before any auction opens): create the Vault
-- secret — its value must never appear in a migration file:
--   SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'auction_bid_amount_key');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.auctions (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Season is required (balance/conservation scope per player+season); week is
  -- deliberately absent (week-agnostic settlement clock).
  season_id         uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  catalog_item_id   uuid        NOT NULL REFERENCES public.item_catalog(id),
  description       text        NOT NULL,
  -- Single-item v1; multi-unit is a later unlock, not a redesign.
  quantity          integer     NOT NULL DEFAULT 1 CHECK (quantity = 1),
  status            text        NOT NULL DEFAULT 'scheduled'
                                CHECK (status IN ('scheduled', 'open', 'settled')),
  opens_at          timestamptz NOT NULL,
  -- Truthful history: "Settle Now" stamps closes_at = now() and runs the one
  -- settlement path, so this is always when the auction ACTUALLY closed.
  closes_at         timestamptz NOT NULL,
  minimum_bid       integer     NOT NULL CHECK (minimum_bid > 0),
  -- Frozen penalty terms per row (no admin knob in v1; settlement reads this).
  bounce_fee        integer     NOT NULL DEFAULT 50 CHECK (bounce_fee >= 0),
  -- The ONLY public bid signal while live. Recounted under the auction lock,
  -- never ±1 (self-healing denorm).
  bidder_count      integer     NOT NULL DEFAULT 0,
  -- Settled denorms — the public story (bid rows are deleted at settlement).
  winner_player_id  uuid        REFERENCES public.players(id),
  winning_bid_id    uuid,       -- FK added below (auction_bids doesn't exist yet)
  winning_price     integer,
  settled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

-- The sweep's working set: due-to-open and due-to-settle scans.
CREATE INDEX auctions_status_closes_idx ON public.auctions (status, closes_at);
CREATE INDEX auctions_status_opens_idx  ON public.auctions (status, opens_at);
CREATE INDEX auctions_season_idx        ON public.auctions (season_id);
CREATE INDEX auctions_catalog_idx       ON public.auctions (catalog_item_id);
CREATE INDEX auctions_winner_idx        ON public.auctions (winner_player_id)
  WHERE winner_player_id IS NOT NULL;

CREATE TABLE public.auction_bids (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auction_id      uuid        NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  player_id       uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- pgp_sym_encrypt ciphertext (randomized per row — equal pledges have
  -- unequal ciphertexts). Decoded ONLY by settle_auction_internal and
  -- my_bid_amount (owner). Plaintext never lands anywhere.
  bid_amount_enc  bytea       NOT NULL,
  -- active|won only: a rejected pledge is destroyed at settlement, never stored.
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won')),
  -- The tie-break clock: reset by every real edit (no-op edits skip), so a tie
  -- goes to whoever held their current amount longest.
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One active bid per player per auction (free re-pricing edits it in place).
CREATE UNIQUE INDEX auction_bids_one_active_per_player
  ON public.auction_bids (auction_id, player_id) WHERE status = 'active';
CREATE INDEX auction_bids_auction_idx ON public.auction_bids (auction_id);
CREATE INDEX auction_bids_player_idx  ON public.auction_bids (player_id);
-- NO ranking index: bid_amount_enc is ciphertext. Settlement decrypts and
-- sorts in memory (league scale: a handful of bids).

ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_winning_bid_id_fkey
  FOREIGN KEY (winning_bid_id) REFERENCES public.auction_bids(id) ON DELETE SET NULL;

-- Close the M1 loop: provenance + revocation key. SET NULL, never CASCADE —
-- an auction deletion must never confiscate a player's item as a side effect
-- (the sanctioned path, reverse_settled_auction, revokes before deleting).
ALTER TABLE public.player_inventory_items
  ADD CONSTRAINT player_inventory_items_auction_id_fkey
  FOREIGN KEY (auction_id) REFERENCES public.auctions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- RLS — reads only (all writes are RPC-only).
-- ---------------------------------------------------------------------------

ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read auctions" ON public.auctions
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- Sealed means sealed: owner-only, ALWAYS, with NO admin carve-out — admins
-- are players in these auctions (and would only see ciphertext anyway).
-- The codebase's first ownership-filtered policy.
ALTER TABLE public.auction_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can read own bids" ON public.auction_bids
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- pin_ledger: the auction root ref + the three new movement types.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pin_ledger
  ADD COLUMN auction_id uuid REFERENCES public.auctions(id) ON DELETE CASCADE;
CREATE INDEX pin_ledger_auction_idx ON public.pin_ledger (auction_id)
  WHERE auction_id IS NOT NULL;

ALTER TABLE public.pin_ledger DROP CONSTRAINT pin_ledger_type_check;
ALTER TABLE public.pin_ledger ADD CONSTRAINT pin_ledger_type_check CHECK ((type = ANY (ARRAY[
  'bonus'::text, 'score_credit'::text,
  'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text,
  'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text,
  'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text,
  'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text,
  'auction_purchase'::text, 'auction_check_bounce'::text, 'bet_insurance_refund'::text
])));

-- bets: the Safety Ticket back-link (one column = structurally one ticket per bet).
ALTER TABLE public.bets
  ADD COLUMN insurance_item_id uuid REFERENCES public.player_inventory_items(id) ON DELETE SET NULL;
CREATE INDEX bets_insurance_item_idx ON public.bets (insurance_item_id)
  WHERE insurance_item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- pin_ledger_double_entry: extend with the auction root ref. CREATE OR REPLACE
-- can't change a signature, so DROP + recreate with the trailing defaulted arg
-- — every existing call site is untouched. Deny-by-default ACL keeps it
-- client-unexecutable (no grants, as before).
-- ---------------------------------------------------------------------------

DROP FUNCTION public.pin_ledger_double_entry(uuid, uuid, uuid, integer, text, text, text, uuid, uuid);

CREATE FUNCTION public.pin_ledger_double_entry(
  p_player_id uuid, p_season_id uuid, p_week_id uuid,
  p_amount integer, p_type text, p_description text,
  p_house_description text DEFAULT NULL,
  p_bet_id uuid DEFAULT NULL,
  p_bounty_post_id uuid DEFAULT NULL,
  p_auction_id uuid DEFAULT NULL
) RETURNS TABLE(player_entry_id uuid, house_entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_player uuid;
  v_house  uuid;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'pin_ledger_double_entry: player_id is required';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'pin_ledger_double_entry: amount must be non-zero';
  END IF;

  INSERT INTO public.pin_ledger
      (player_id, season_id, week_id, is_house, amount, type, description, bet_id, bounty_post_id, auction_id)
    VALUES
      (p_player_id, p_season_id, p_week_id, false, p_amount, p_type, p_description, p_bet_id, p_bounty_post_id, p_auction_id)
    RETURNING id INTO v_player;

  INSERT INTO public.pin_ledger
      (player_id, season_id, week_id, is_house, amount, type, description, bet_id, bounty_post_id, auction_id)
    VALUES
      (NULL, p_season_id, p_week_id, true, -p_amount, p_type,
       COALESCE(p_house_description, p_description || ' (house)'), p_bet_id, p_bounty_post_id, p_auction_id)
    RETURNING id INTO v_house;

  RETURN QUERY SELECT v_player, v_house;
END;
$$;

-- ---------------------------------------------------------------------------
-- Bid-amount encryption helpers. Key lives in Supabase Vault (see the manual
-- step in the header) — never in a migration, never in the schema snapshot.
-- All three are SECURITY DEFINER with no grants: only other definer functions
-- (place_auction_bid, settle_auction_internal, my_bid_amount) may call them.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

CREATE FUNCTION public.auction_bid_key()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'auction_bid_amount_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Vault secret auction_bid_amount_key is missing — create it before running auctions';
  END IF;
  RETURN v_key;
END;
$$;

CREATE FUNCTION public.encrypt_bid_amount(p_amount integer)
RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT extensions.pgp_sym_encrypt(p_amount::text, public.auction_bid_key());
$$;

CREATE FUNCTION public.decrypt_bid_amount(p_enc bytea)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT extensions.pgp_sym_decrypt(p_enc, public.auction_bid_key())::integer;
$$;
