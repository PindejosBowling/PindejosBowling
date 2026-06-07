-- ============================================================================
-- PvP Challenge Contracts — tables, indexes, and RLS.
-- ============================================================================
-- Three append-only / lifecycle tables: pvp_challenges (contract lifecycle),
-- pvp_challenge_offers (negotiation trail), pvp_ledger (economic event log).
-- All player write paths go through SECURITY DEFINER RPCs; RLS here opens reads
-- and admin-direct writes only.
--
-- Naming rule: every table is pvp_* so they sort together alphabetically.
-- pin_ledger linking column added in the next migration (pin_ledger_pvp_support).
--
-- Audit: created_at + updated_at only; enforce_audit_columns event trigger
-- auto-attaches set_updated_at — do NOT declare it here (it would collide).
-- ============================================================================


-- ============================================================================
-- 1. pvp_challenges — Challenge Contract lifecycle table.
-- ============================================================================
-- One row = current accepted terms. Negotiation trail lives in pvp_challenge_offers.
-- No stored balance/escrow — escrow is derived from pvp_ledger.
-- counterparty_player_id IS NULL = open-board contract (first taker fills it).
CREATE TABLE public.pvp_challenges (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_type            text        NOT NULL CHECK (contract_type IN ('line_duel','prop_duel','raw_score_duel')),
  status                   text        NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending','countered','accepted','locked','settled','pushed','voided','cancelled','expired'
                           )),
  creator_player_id        uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  counterparty_player_id   uuid        NULL     REFERENCES public.players(id) ON DELETE CASCADE,
  season_id                uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_id                  uuid        NOT NULL REFERENCES public.weeks(id)   ON DELETE CASCADE,
  game_number              int         NULL     CHECK (game_number IS NULL OR game_number >= 1),
  creator_stake            int         NOT NULL CHECK (creator_stake > 0),
  counterparty_stake       int         NOT NULL CHECK (counterparty_stake > 0),
  total_pot                int         NOT NULL CHECK (total_pot > 0),
  rake_amount              int         NOT NULL CHECK (rake_amount >= 0),
  payout_amount            int         NOT NULL CHECK (payout_amount >= 0),
  creator_line             numeric(6,1) NULL,
  counterparty_line        numeric(6,1) NULL,
  prop_market_id           uuid        NULL     REFERENCES public.bet_markets(id) ON DELETE SET NULL,
  creator_selection        text        NULL,
  counterparty_selection   text        NULL,
  subject_player_id        uuid        NULL     REFERENCES public.players(id) ON DELETE SET NULL,
  expires_at               timestamptz NOT NULL,
  accepted_at              timestamptz NULL,
  locked_at                timestamptz NULL,
  settled_at               timestamptz NULL,
  winner_player_id         uuid        NULL     REFERENCES public.players(id) ON DELETE SET NULL,
  result_detail            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  creator_message          text        NULL,
  admin_note               text        NULL,
  rematch_of_challenge_id  uuid        NULL     REFERENCES public.pvp_challenges(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pvp_challenges_creator_player_id_idx       ON public.pvp_challenges (creator_player_id);
CREATE INDEX pvp_challenges_counterparty_player_id_idx  ON public.pvp_challenges (counterparty_player_id);
CREATE INDEX pvp_challenges_season_id_idx               ON public.pvp_challenges (season_id);
CREATE INDEX pvp_challenges_week_id_idx                 ON public.pvp_challenges (week_id);
CREATE INDEX pvp_challenges_prop_market_id_idx          ON public.pvp_challenges (prop_market_id);
CREATE INDEX pvp_challenges_subject_player_id_idx       ON public.pvp_challenges (subject_player_id);
CREATE INDEX pvp_challenges_winner_player_id_idx        ON public.pvp_challenges (winner_player_id);
CREATE INDEX pvp_challenges_rematch_of_challenge_id_idx ON public.pvp_challenges (rematch_of_challenge_id);
CREATE INDEX pvp_challenges_status_expires_at_idx       ON public.pvp_challenges (status, expires_at);


-- ============================================================================
-- 2. pvp_challenge_offers — append-only negotiation trail.
-- ============================================================================
-- The latest row with superseded_at IS NULL AND accepted_at IS NULL AND
-- declined_at IS NULL is the only acceptable offer (design §6.3).
CREATE TABLE public.pvp_challenge_offers (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id           uuid        NOT NULL REFERENCES public.pvp_challenges(id) ON DELETE CASCADE,
  offered_by_player_id   uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  offer_no               int         NOT NULL CHECK (offer_no >= 1),
  contract_type          text        NOT NULL,
  creator_stake          int         NOT NULL CHECK (creator_stake > 0),
  counterparty_stake     int         NOT NULL CHECK (counterparty_stake > 0),
  game_number            int         NULL,
  prop_market_id         uuid        NULL REFERENCES public.bet_markets(id) ON DELETE SET NULL,
  creator_selection      text        NULL,
  counterparty_selection text        NULL,
  expires_at             timestamptz NOT NULL,
  message                text        NULL,
  superseded_at          timestamptz NULL,
  accepted_at            timestamptz NULL,
  declined_at            timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pvp_challenge_offers_challenge_id_idx         ON public.pvp_challenge_offers (challenge_id);
CREATE INDEX pvp_challenge_offers_offered_by_player_id_idx ON public.pvp_challenge_offers (offered_by_player_id);
-- Fast lookup of the live offer for a contract.
CREATE INDEX pvp_challenge_offers_live_offer_idx
  ON public.pvp_challenge_offers (challenge_id)
  WHERE superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL;


-- ============================================================================
-- 3. pvp_ledger — append-only PvP economic event log.
-- ============================================================================
-- Every pin movement for a contract has a row here, linked to the matching
-- pin_ledger row. pin_ledger_id FK is added in the next migration after
-- pin_ledger.pvp_ledger_id exists (mutual reference — both nullable).
--
-- Sign convention (enforced by RPCs):
--   stake:   player -stake,  house +stake   (escrow on accept)
--   payout:  player +payout, house -payout  (winner paid out)
--   rake:    house only,     +rake_amount    (house keeps cut)
--   refund:  player +stake,  house -stake   (push/void/cancel)
CREATE TABLE public.pvp_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid        NOT NULL REFERENCES public.pvp_challenges(id) ON DELETE CASCADE,
  player_id     uuid        NULL     REFERENCES public.players(id)  ON DELETE CASCADE,
  season_id     uuid        NOT NULL REFERENCES public.seasons(id)  ON DELETE CASCADE,
  week_id       uuid        NULL     REFERENCES public.weeks(id)    ON DELETE SET NULL,
  amount        int         NOT NULL,
  type          text        NOT NULL CHECK (type IN ('stake','payout','refund','rake')),
  description   text        NOT NULL,
  pin_ledger_id uuid        NULL,  -- FK to pin_ledger added in pin_ledger_pvp_support migration
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pvp_ledger_challenge_id_idx  ON public.pvp_ledger (challenge_id);
CREATE INDEX pvp_ledger_player_id_idx     ON public.pvp_ledger (player_id);
CREATE INDEX pvp_ledger_season_id_idx     ON public.pvp_ledger (season_id);
CREATE INDEX pvp_ledger_week_id_idx       ON public.pvp_ledger (week_id);
CREATE INDEX pvp_ledger_pin_ledger_id_idx ON public.pvp_ledger (pin_ledger_id);


-- ============================================================================
-- 4. RLS — mirror the bet_* / loan_* tables.
-- ============================================================================
-- Reads open to anon + authenticated; direct INSERT/UPDATE/DELETE admin-only.
-- All player write paths run through SECURITY DEFINER RPCs (which bypass RLS).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pvp_challenges', 'pvp_challenge_offers', 'pvp_ledger'] LOOP
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
