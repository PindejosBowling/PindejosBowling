-- ============================================================================
-- Bounty Board — tables (design §18–§22; economy/BOUNTIES_DB.md §1).
-- ============================================================================
-- The DB foundation for the Bounty Board feature. Four lifecycle / append-shaped
-- tables (bounty_post, bounty_hunter_stakes, bounty_settlements, bounty_payouts).
-- No stored balances — escrow + seed are derived from pin_ledger / computed at
-- settlement. All player write paths go through the SECURITY DEFINER RPCs in a
-- later migration; RLS here only opens reads + admin-direct writes.
--
-- Audit columns: created_at + updated_at only; the enforce_audit_columns event
-- trigger auto-attaches set_updated_at (do NOT declare it here — it collides).
--
-- Table names are verbatim from design §18 (note: singular bounty_post). There is
-- no `cancelled` status anywhere — admin cancellation is a hard delete (§27).
-- ============================================================================


-- ============================================================================
-- 1. bounty_post — the root object (design §19).
-- ============================================================================
CREATE TABLE public.bounty_post (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_id               uuid REFERENCES public.weeks(id) ON DELETE SET NULL,
  bounty_type           text NOT NULL CHECK (bounty_type IN ('house_bounty','sponsor_bounty')),
  sponsor_player_id     uuid REFERENCES public.players(id) ON DELETE CASCADE,  -- NULL for house_bounty
  title                 text NOT NULL,         -- freeform (≤80 chars, app-enforced)
  description           text NOT NULL,         -- freeform (≤1000 chars, app-enforced)
  sponsor_bounty_amount int  NOT NULL CHECK (sponsor_bounty_amount > 0),
  hunter_stake_amount   int  NOT NULL CHECK (hunter_stake_amount > 0),
  house_seed_mode       text NOT NULL DEFAULT 'early_hunter_anti_dilution'
                          CHECK (house_seed_mode = 'early_hunter_anti_dilution'),
  closes_at             timestamptz NOT NULL,  -- no DB default; computed in app logic (design §11)
  status                text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','closed','settled')),  -- no `cancelled` (cancel = delete, §27)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Type/sponsor consistency (design §19.2).
  CONSTRAINT bounty_post_sponsor_consistency CHECK (
    (bounty_type = 'house_bounty'   AND sponsor_player_id IS NULL) OR
    (bounty_type = 'sponsor_bounty' AND sponsor_player_id IS NOT NULL)
  ),
  CONSTRAINT bounty_post_closes_after_create CHECK (closes_at > created_at)
);

CREATE INDEX bounty_post_season_id_idx  ON public.bounty_post (season_id);
CREATE INDEX bounty_post_week_id_idx     ON public.bounty_post (week_id);
CREATE INDEX bounty_post_sponsor_idx     ON public.bounty_post (sponsor_player_id)
  WHERE sponsor_player_id IS NOT NULL;
CREATE INDEX bounty_post_board_idx ON public.bounty_post (season_id, status, closes_at, created_at DESC);
CREATE INDEX bounty_post_week_board_idx ON public.bounty_post (week_id, status, closes_at);


-- ============================================================================
-- 2. bounty_hunter_stakes — a hunter's entry (design §20).
-- ============================================================================
-- One row per hunter; at most one per player per bounty. stake_amount,
-- entry_number, and protected_hunter_profit are all snapshotted at entry and
-- never change (the anti-dilution invariant, §20.3).
CREATE TABLE public.bounty_hunter_stakes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_post_id           uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE,
  player_id                uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  stake_amount             int  NOT NULL CHECK (stake_amount > 0),       -- snapshot of hunter_stake_amount
  entry_number             int  NOT NULL CHECK (entry_number >= 1),      -- order of entry, assigned transactionally
  protected_hunter_profit  int  NOT NULL CHECK (protected_hunter_profit >= 0),  -- floor(S / entry_number), snapshotted
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','won','lost')),  -- no refunded/voided/cancelled
  entered_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bounty_hunter_unique_player       UNIQUE (bounty_post_id, player_id),
  CONSTRAINT bounty_hunter_unique_entry_number UNIQUE (bounty_post_id, entry_number)
);

-- The two unique constraints already cover (bounty_post_id, *); add the player index.
CREATE INDEX bounty_hunter_stakes_player_idx ON public.bounty_hunter_stakes (player_id, bounty_post_id);


-- ============================================================================
-- 3. bounty_settlements — the resolved outcome + snapshot economics (design §21).
-- ============================================================================
-- One row per settled bounty (enforced by the unique index below).
CREATE TABLE public.bounty_settlements (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_post_id                uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE,
  settlement_outcome            text NOT NULL CHECK (settlement_outcome IN ('sponsor_win','hunter_win')),  -- no `void`
  settlement_source             text NOT NULL DEFAULT 'admin' CHECK (settlement_source = 'admin'),         -- admin only in v1
  total_sponsor_bounty          int  NOT NULL,  -- snapshot of sponsor_bounty_amount
  total_hunter_stakes           int  NOT NULL,  -- SUM(stake_amount)
  total_protected_hunter_profit int  NOT NULL,  -- SUM(protected_hunter_profit)
  total_house_seed              int  NOT NULL,  -- max(0, total_protected_hunter_profit - total_sponsor_bounty)
  total_pot                     int  NOT NULL,  -- total_sponsor_bounty + total_hunter_stakes + total_house_seed
  winner_count                  int  NOT NULL,  -- 1 (sponsor_win) or hunter count (hunter_win)
  settled_by_admin_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE SET NULL,  -- resolving admin's player id
  admin_settlement_reasoning    text NOT NULL,  -- required justification (§21.4), shown publicly
  settled_at                    timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- Single settlement per post.
CREATE UNIQUE INDEX bounty_settlements_one_per_post ON public.bounty_settlements (bounty_post_id);
CREATE INDEX        bounty_settlements_admin_idx    ON public.bounty_settlements (settled_by_admin_id);


-- ============================================================================
-- 4. bounty_payouts — winner-specific payout rows (design §22).
-- ============================================================================
CREATE TABLE public.bounty_payouts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_settlement_id  uuid NOT NULL REFERENCES public.bounty_settlements(id) ON DELETE CASCADE,
  bounty_post_id        uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE,  -- denormalized for cancel/index
  player_id             uuid REFERENCES public.players(id) ON DELETE CASCADE,  -- NULL only for the optional House row
  is_house              boolean NOT NULL DEFAULT false,
  payout_amount         int  NOT NULL CHECK (payout_amount > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bounty_payouts_post_idx       ON public.bounty_payouts (bounty_post_id);
CREATE INDEX bounty_payouts_settlement_idx ON public.bounty_payouts (bounty_settlement_id);
CREATE INDEX bounty_payouts_player_idx     ON public.bounty_payouts (player_id);


-- ============================================================================
-- 5. RLS — mirror the pvp_* / loan_* tables (reads open; direct writes admin-only).
-- ============================================================================
-- All player write paths run through SECURITY DEFINER RPCs (which bypass RLS), so
-- players never write these tables directly.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bounty_post', 'bounty_hunter_stakes', 'bounty_settlements', 'bounty_payouts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "anon can read"          ON public.%I FOR SELECT TO anon          USING (true)', t);
    EXECUTE format('CREATE POLICY "authenticated can read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format($f$CREATE POLICY "admin can insert" ON public.%I FOR INSERT TO authenticated
      WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
    EXECUTE format($f$CREATE POLICY "admin can update" ON public.%I FOR UPDATE TO authenticated
      USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
      WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
    EXECUTE format($f$CREATE POLICY "admin can delete" ON public.%I FOR DELETE TO authenticated
      USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
  END LOOP;
END $$;
