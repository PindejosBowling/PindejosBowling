-- ============================================================================
-- Canonical betting schema (target model)
-- ============================================================================
-- Sportsbook-standard model:  markets → selections → bets → legs, plus a peer
-- challenge/accept layer (offers + matches). Supports over/unders, moneylines,
-- arbitrary props (jsonb params), parlays (multi-leg bets), non-even odds (per
-- selection, snapshotted per leg), and both house-banked and player-vs-player
-- wagers.
--
-- DESIGN NOTES
--   • `bets` is the single source of truth for "money placed" and carries NO
--     bet-type-specific columns. WHAT was bet lives in bet_legs → bet_selections.
--   • A bet with one leg is a single; a bet with N legs is a parlay. There is no
--     parlay table — parlay-ness is emergent.
--   • A leg snapshots odds_at_placement / line_at_placement because posted prices
--     move after a bet is taken.
--   • back vs lay (bet_legs.side) expresses "for" vs "against" a selection. House
--     bets are all `back` (the house implicitly lays). A peer wager is a `back`
--     leg matched against a `lay` leg on the same selection.
--   • Counterparty (bets.counterparty) is `house` (funded system account, decided
--     in design) or `peer` (zero-sum escrow between two players, pooled in
--     bet_matches).
--
-- SCOPE: this migration is ADDITIVE. Legacy bet_lines / placed_bets and the live
-- betting UI keep working until the app is ported. The pin-ledger house/escrow
-- accounting extension and the placement/settlement SECURITY DEFINER RPCs land in
-- a follow-up that ships with the app cutover (where they are exercised/tested).
--
-- updated_at: the enforce_audit_columns event trigger auto-attaches set_updated_at
-- to every table created here (and enforces created_at/updated_at exist), so no
-- per-table trigger is declared below.
-- ============================================================================

-- 1. MARKETS — a thing you can bet on.
CREATE TABLE public.bet_markets (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  market_type          text         NOT NULL CHECK (market_type IN ('over_under', 'moneyline', 'prop')),
  title                text         NOT NULL,                          -- display label
  week_id              uuid         REFERENCES public.weeks(id)   ON DELETE CASCADE,  -- scope; null = season/futures
  game_number          integer      CHECK (game_number IS NULL OR game_number >= 1),
  subject_player_id    uuid         REFERENCES public.players(id) ON DELETE CASCADE,  -- the player a prop/line is about
  params               jsonb        NOT NULL DEFAULT '{}'::jsonb,      -- type-specific descriptive bits
  status               text         NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'closed', 'settled', 'void')),
  result_value         numeric(6,1),                                   -- generic settled outcome (e.g. actual score)
  created_by_player_id uuid         REFERENCES public.players(id) ON DELETE SET NULL, -- null = house-created
  settled_at           timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

-- 2. SELECTIONS — the bettable sides of a market, each with its own odds + line.
--    O/U: two rows ('over','under') sharing a line. Moneyline: one per side.
--    Prop: 'yes'/'no' or N choices. odds are DECIMAL (2.000 = even, payout =
--    stake × odds).
CREATE TABLE public.bet_selections (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   uuid         NOT NULL REFERENCES public.bet_markets(id) ON DELETE CASCADE,
  key         text         NOT NULL,                                   -- 'over','under','yes', a player id, ...
  label       text         NOT NULL,                                   -- display
  odds        numeric(8,3) NOT NULL DEFAULT 2.000 CHECK (odds > 1.0),  -- decimal odds incl. stake
  line        numeric(6,1),                                            -- total/handicap for this side (the O/U number)
  result      text         CHECK (result IN ('won', 'lost', 'push', 'void')),
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (market_id, key)
);

-- 3. BETS — a player's stake. Single source of truth for money placed; type-agnostic.
CREATE TABLE public.bets (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid         NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,  -- the bettor
  season_id        uuid         NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,  -- balance scope (matches pin_ledger)
  counterparty     text         NOT NULL CHECK (counterparty IN ('house', 'peer')),
  stake            integer      NOT NULL CHECK (stake >= 10),
  potential_payout integer      NOT NULL,                              -- total returned on win incl. stake (snapshot)
  status           text         NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'won', 'lost', 'push', 'void', 'cancelled')),
  placed_at        timestamptz  NOT NULL DEFAULT now(),
  settled_at       timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- 4. BET LEGS — bet ↔ selection. 1 leg = single, N legs = parlay. Snapshots the
--    price at placement and records back vs lay.
CREATE TABLE public.bet_legs (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id            uuid         NOT NULL REFERENCES public.bets(id)           ON DELETE CASCADE,
  selection_id      uuid         NOT NULL REFERENCES public.bet_selections(id) ON DELETE CASCADE,
  side              text         NOT NULL DEFAULT 'back' CHECK (side IN ('back', 'lay')),
  odds_at_placement numeric(8,3) NOT NULL CHECK (odds_at_placement > 1.0),
  line_at_placement numeric(6,1),
  result            text         CHECK (result IN ('won', 'lost', 'push', 'void')),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (bet_id, selection_id)
);

-- 5. BET OFFERS — peer challenge/accept. A proposer backs a selection at agreed
--    odds for a stake; another player (or anyone, if target is null) accepts the
--    opposing lay side. Acceptor's required stake (liability) = stake × (odds − 1).
CREATE TABLE public.bet_offers (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id      uuid         NOT NULL REFERENCES public.players(id)        ON DELETE CASCADE,
  season_id        uuid         NOT NULL REFERENCES public.seasons(id)        ON DELETE CASCADE,
  selection_id     uuid         NOT NULL REFERENCES public.bet_selections(id) ON DELETE CASCADE,
  odds             numeric(8,3) NOT NULL CHECK (odds > 1.0),
  proposer_stake   integer      NOT NULL CHECK (proposer_stake >= 10),
  target_player_id uuid         REFERENCES public.players(id) ON DELETE CASCADE,  -- null = open to anyone
  status           text         NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'accepted', 'cancelled', 'expired')),
  accepted_by      uuid         REFERENCES public.players(id) ON DELETE SET NULL,
  accepted_at      timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- 6. BET MATCHES — links the two opposing bets created when an offer is accepted,
--    and records the pooled escrow the winner collects (zero-sum, peer-vs-peer).
CREATE TABLE public.bet_matches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid        REFERENCES public.bet_offers(id) ON DELETE SET NULL,
  back_bet_id uuid        NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  lay_bet_id  uuid        NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  pool        integer     NOT NULL CHECK (pool >= 0),     -- back_stake + lay_stake; winner takes (minus rake)
  rake        integer     NOT NULL DEFAULT 0 CHECK (rake >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (back_bet_id),
  UNIQUE (lay_bet_id)
);

-- ----------------------------------------------------------------------------
-- Indexes on foreign-key columns (Postgres does not auto-create these). Cover
-- the hot lookups and every cascade path.
-- ----------------------------------------------------------------------------
CREATE INDEX idx_bet_markets_week           ON public.bet_markets (week_id);
CREATE INDEX idx_bet_markets_subject        ON public.bet_markets (subject_player_id);
CREATE INDEX idx_bet_markets_created_by     ON public.bet_markets (created_by_player_id);
CREATE INDEX idx_bet_markets_status         ON public.bet_markets (status);

CREATE INDEX idx_bet_selections_market      ON public.bet_selections (market_id);

CREATE INDEX idx_bets_player_season         ON public.bets (player_id, season_id);
CREATE INDEX idx_bets_season                ON public.bets (season_id);
CREATE INDEX idx_bets_status                ON public.bets (status);

CREATE INDEX idx_bet_legs_bet               ON public.bet_legs (bet_id);
CREATE INDEX idx_bet_legs_selection         ON public.bet_legs (selection_id);

CREATE INDEX idx_bet_offers_selection       ON public.bet_offers (selection_id);
CREATE INDEX idx_bet_offers_proposer        ON public.bet_offers (proposer_id);
CREATE INDEX idx_bet_offers_season          ON public.bet_offers (season_id);
CREATE INDEX idx_bet_offers_target          ON public.bet_offers (target_player_id);
CREATE INDEX idx_bet_offers_status          ON public.bet_offers (status);

CREATE INDEX idx_bet_matches_offer          ON public.bet_matches (offer_id);

-- ----------------------------------------------------------------------------
-- RLS — reads open (matches existing betting tables); direct writes admin-only.
-- Player write paths (place bet, create/accept offer) will go through
-- SECURITY DEFINER RPCs in the phase-2 cutover, the same pattern as place_bet /
-- sync_bet_lines_for_week.
-- ----------------------------------------------------------------------------
ALTER TABLE public.bet_markets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_legs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_offers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_matches    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bet_markets','bet_selections','bets','bet_legs','bet_offers','bet_matches']
  LOOP
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
