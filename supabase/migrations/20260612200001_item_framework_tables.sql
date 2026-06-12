-- Item framework (Silent Auctions M1 — context/economy/AUCTION_FINDINGS.md §1).
--
-- The league's first inventory system, designed as bedrock for the Auction
-- House and the future Merchant/marketplace:
--   * item_catalog        — definitions. Functional columns (effect_type,
--                           effect_params, activation_mode) are IMMUTABLE once
--                           an instance exists (enforced in update_catalog_item;
--                           changed behavior = new key). name/description/icon
--                           stay editable; retirement = is_active=false.
--   * player_inventory_items — ATOMIC SINGLE-USE rows. There is no charge
--                           counter anywhere: quantity is always row count, and
--                           an item's whole lifecycle is consumed_at NULL→ts.
--                           Season-scoped: usable only in their own season.
--
-- All-RPC write posture: neither table has any INSERT/UPDATE/DELETE policy —
-- writes go exclusively through the SECURITY DEFINER RPCs below, so the
-- invariants are structural (the pin_ledger_double_entry doctrine).

CREATE TABLE public.item_catalog (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key             text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  description     text        NOT NULL,
  icon            text        NOT NULL,
  -- A closed enum: each value is a promise that a real code hook exists (or
  -- the effect is honored manually). New value = new migration = new behavior.
  effect_type     text        NOT NULL CHECK (effect_type IN
    ('bet_insurance', 'cosmetic', 'access_pass', 'custom')),
  -- Parametrizes within a type (e.g. refund_share) so variants are catalog
  -- rows, not code changes. Schema documented per-type in SILENT_AUCTIONS_DB.md.
  effect_params   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Drives the UI affordance only: attach_to_bet → wager-sheet toggle,
  -- passive → always-on, admin_honored → "see the House".
  activation_mode text        NOT NULL CHECK (activation_mode IN
    ('attach_to_bet', 'passive', 'admin_honored')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.player_inventory_items (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id       uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  catalog_item_id uuid        NOT NULL REFERENCES public.item_catalog(id),
  -- Season-scoped property: consumption hooks require season = current season;
  -- a closed season's items are inert history (expiry is derived, no column).
  season_id       uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  source          text        NOT NULL CHECK (source IN ('auction', 'merchant', 'admin_grant')),
  -- Provenance + the reverse-settlement revocation key. Bare column here; the
  -- FK to auctions is added in M2 (auctions doesn't exist yet), ON DELETE SET
  -- NULL — an unforeseen auction deletion orphans provenance, never confiscates.
  auction_id      uuid,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  -- The whole lifecycle. NULL = ready; timestamp = spent (single use).
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX player_inventory_items_player_idx  ON public.player_inventory_items (player_id);
CREATE INDEX player_inventory_items_catalog_idx ON public.player_inventory_items (catalog_item_id);
CREATE INDEX player_inventory_items_season_idx  ON public.player_inventory_items (season_id);
CREATE INDEX player_inventory_items_auction_idx ON public.player_inventory_items (auction_id)
  WHERE auction_id IS NOT NULL;

-- RLS: reads only (writes are RPC-only — no write policies exist on purpose).
ALTER TABLE public.item_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read catalog" ON public.item_catalog
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

ALTER TABLE public.player_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner or admin can read inventory" ON public.player_inventory_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Catalog admin RPCs — the only write doors. The immutability guard lives in
-- update_catalog_item, which is why direct admin table writes don't exist.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.create_catalog_item(
  p_key text, p_name text, p_description text, p_icon text,
  p_effect_type text, p_effect_params jsonb, p_activation_mode text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  INSERT INTO public.item_catalog (key, name, description, icon, effect_type, effect_params, activation_mode)
    VALUES (p_key, p_name, p_description, p_icon, p_effect_type,
            COALESCE(p_effect_params, '{}'::jsonb), p_activation_mode)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.update_catalog_item(
  p_catalog_item_id uuid,
  p_name text, p_description text, p_icon text,
  p_effect_type text, p_effect_params jsonb, p_activation_mode text,
  p_is_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_cat public.item_catalog;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_cat FROM public.item_catalog WHERE id = p_catalog_item_id;
  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Catalog item not found';
  END IF;

  -- Functional immutability: once any instance exists, behavior is frozen.
  -- Changed behavior = a NEW catalog row with a new key (e.g. safety_ticket_v2).
  IF EXISTS (SELECT 1 FROM public.player_inventory_items WHERE catalog_item_id = p_catalog_item_id)
     AND (p_effect_type      IS DISTINCT FROM v_cat.effect_type
       OR COALESCE(p_effect_params, '{}'::jsonb) IS DISTINCT FROM v_cat.effect_params
       OR p_activation_mode  IS DISTINCT FROM v_cat.activation_mode) THEN
    RAISE EXCEPTION 'Catalog item % has granted instances — its functional columns are frozen. Create a new item key instead.', v_cat.key;
  END IF;

  UPDATE public.item_catalog
     SET name            = p_name,
         description     = p_description,
         icon            = p_icon,
         effect_type     = p_effect_type,
         effect_params   = COALESCE(p_effect_params, '{}'::jsonb),
         activation_mode = p_activation_mode,
         is_active       = p_is_active
   WHERE id = p_catalog_item_id;
END;
$$;

-- Deny-by-default ACL leaves these unexecutable; the admin gate is in-function,
-- so authenticated may hold EXECUTE.
GRANT EXECUTE ON FUNCTION public.create_catalog_item(text, text, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_catalog_item(uuid, text, text, text, text, jsonb, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the Safety Ticket (the one wired effect in v1). refund_share is read
-- by finalize_bets_for_market (M5) — a half-refund variant is later just a new
-- row with 0.5, zero hook changes.
-- ---------------------------------------------------------------------------
INSERT INTO public.item_catalog (key, name, description, icon, effect_type, effect_params, activation_mode)
VALUES (
  'safety_ticket',
  'Safety Ticket',
  'Bet insurance. Attach it when placing a bet in the Sportsbook: if that bet loses, your full stake comes back. The ticket is spent at placement, win or lose.',
  '🎟️',
  'bet_insurance',
  '{"refund_share": 1.0}'::jsonb,
  'attach_to_bet'
);
