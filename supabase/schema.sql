-- Current-state schema snapshot of the public schema.
-- GENERATED — do not edit by hand. Regenerate after every `supabase db push`.
-- Source of truth for CURRENT schema; migration files are append-only history.

-- =====================================================
-- TABLES
-- =====================================================

CREATE TABLE activity_feed_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  week_id uuid,
  source_feature text NOT NULL,
  event_type text NOT NULL,
  actor_player_id uuid,
  subject_player_id uuid,
  secondary_player_id uuid,
  sportsbook_bet_id uuid,
  loan_id uuid,
  visibility text NOT NULL DEFAULT 'public'::text,
  status text NOT NULL DEFAULT 'published'::text,
  template_key text NOT NULL,
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp with time zone NOT NULL,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  suppressed_by_admin_id uuid,
  suppressed_at timestamp with time zone,
  suppression_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  pvp_challenge_id uuid,
  bounty_post_id uuid
);

CREATE TABLE bet_legs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bet_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  side text NOT NULL DEFAULT 'back'::text,
  odds_at_placement numeric(8,3) NOT NULL,
  line_at_placement numeric(6,1),
  result text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bet_markets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_type text NOT NULL,
  title text NOT NULL,
  week_id uuid,
  game_number integer,
  subject_player_id uuid,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open'::text,
  result_value numeric(6,1),
  created_by_player_id uuid,
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  subject_game_id uuid
);

CREATE TABLE bet_matches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  offer_id uuid,
  back_bet_id uuid NOT NULL,
  lay_bet_id uuid NOT NULL,
  pool integer NOT NULL,
  rake integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bet_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  proposer_id uuid NOT NULL,
  season_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  odds numeric(8,3) NOT NULL,
  proposer_stake integer NOT NULL,
  target_player_id uuid,
  status text NOT NULL DEFAULT 'open'::text,
  accepted_by uuid,
  accepted_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bet_selections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  odds numeric(8,3) NOT NULL DEFAULT 2.000,
  line numeric(6,1),
  result text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  season_id uuid NOT NULL,
  counterparty text NOT NULL,
  stake integer NOT NULL,
  potential_payout integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE board_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bounty_hunter_stakes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bounty_post_id uuid NOT NULL,
  player_id uuid NOT NULL,
  stake_amount integer NOT NULL,
  entry_number integer NOT NULL,
  protected_hunter_profit integer NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  entered_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bounty_payouts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bounty_settlement_id uuid NOT NULL,
  bounty_post_id uuid NOT NULL,
  player_id uuid,
  is_house boolean NOT NULL DEFAULT false,
  payout_amount integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bounty_post (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  week_id uuid,
  bounty_type text NOT NULL,
  sponsor_player_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  sponsor_bounty_amount integer NOT NULL,
  hunter_stake_amount integer NOT NULL,
  house_seed_mode text NOT NULL DEFAULT 'early_hunter_anti_dilution'::text,
  closes_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  reward_per_hunter integer NOT NULL,
  max_hunters integer NOT NULL
);

CREATE TABLE bounty_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bounty_post_id uuid NOT NULL,
  settlement_outcome text NOT NULL,
  settlement_source text NOT NULL DEFAULT 'admin'::text,
  total_sponsor_bounty integer NOT NULL,
  total_hunter_stakes integer NOT NULL,
  total_protected_hunter_profit integer NOT NULL,
  total_house_seed integer NOT NULL,
  total_pot integer NOT NULL,
  winner_count integer NOT NULL,
  settled_by_admin_id uuid NOT NULL,
  admin_settlement_reasoning text NOT NULL,
  settled_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_number integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  team_a_id uuid NOT NULL,
  team_b_id uuid NOT NULL
);

CREATE TABLE loan_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL,
  player_id uuid NOT NULL,
  season_id uuid NOT NULL,
  week_id uuid,
  amount integer NOT NULL,
  type text NOT NULL,
  description text NOT NULL,
  pin_ledger_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE loan_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid,
  display_name text NOT NULL,
  description text NOT NULL,
  special_warning_text text,
  risk_level text NOT NULL,
  borrow_amount integer NOT NULL,
  weekly_interest_rate numeric(5,4) NOT NULL,
  garnishment_rate numeric(5,4) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  available_from timestamp with time zone,
  available_until timestamp with time zone,
  max_uses integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE loans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  season_id uuid NOT NULL,
  loan_product_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  paid_off_at timestamp with time zone,
  season_closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE pin_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid,
  season_id uuid NOT NULL,
  amount integer NOT NULL,
  type text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_house boolean NOT NULL DEFAULT false,
  bet_id uuid,
  week_id uuid,
  loan_ledger_id uuid,
  pvp_ledger_id uuid,
  bounty_post_id uuid,
  bounty_hunter_stake_id uuid,
  bounty_settlement_id uuid,
  bounty_payout_id uuid
);

CREATE TABLE players (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  name text DEFAULT 
CASE
    WHEN (last_name = ''::text) THEN first_name
    ELSE ((first_name || ' '::text) || last_name)
END,
  user_id uuid,
  role text NOT NULL DEFAULT 'player'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  avatar_path text,
  jersey_purchased boolean NOT NULL DEFAULT false
);

CREATE TABLE pvp_challenge_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL,
  offered_by_player_id uuid NOT NULL,
  offer_no integer NOT NULL,
  contract_type text NOT NULL,
  creator_stake integer NOT NULL,
  counterparty_stake integer NOT NULL,
  game_number integer,
  prop_market_id uuid,
  creator_selection text,
  counterparty_selection text,
  message text,
  superseded_at timestamp with time zone,
  accepted_at timestamp with time zone,
  declined_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE pvp_challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contract_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  creator_player_id uuid NOT NULL,
  counterparty_player_id uuid,
  season_id uuid NOT NULL,
  week_id uuid NOT NULL,
  game_number integer,
  creator_stake integer NOT NULL,
  counterparty_stake integer NOT NULL,
  total_pot integer NOT NULL,
  payout_amount integer NOT NULL,
  creator_line numeric(6,1),
  counterparty_line numeric(6,1),
  prop_market_id uuid,
  creator_selection text,
  counterparty_selection text,
  subject_player_id uuid,
  accepted_at timestamp with time zone,
  locked_at timestamp with time zone,
  settled_at timestamp with time zone,
  winner_player_id uuid,
  result_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  creator_message text,
  admin_note text,
  rematch_of_challenge_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  custom_title text,
  custom_description text,
  creator_handicap integer NOT NULL DEFAULT 0,
  counterparty_handicap integer NOT NULL DEFAULT 0
);

CREATE TABLE pvp_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL,
  player_id uuid,
  season_id uuid NOT NULL,
  week_id uuid,
  amount integer NOT NULL,
  type text NOT NULL,
  description text NOT NULL,
  pin_ledger_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  season_id uuid NOT NULL,
  payment_received boolean NOT NULL DEFAULT false
);

CREATE TABLE rsvp (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL,
  player_id uuid NOT NULL,
  status text NOT NULL,
  note text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_slot_id uuid NOT NULL,
  score integer,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  game_id uuid NOT NULL
);

CREATE TABLE season_champions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  season_id uuid NOT NULL
);

CREATE TABLE seasons (
  number integer NOT NULL,
  bowling_night text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  registration_open boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  id uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE team_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid,
  slot integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  team_id uuid NOT NULL,
  is_fill boolean DEFAULT (player_id IS NULL)
);

CREATE TABLE teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL,
  team_number integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE weeks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  week_number integer NOT NULL,
  bowled_at date,
  is_confirmed boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  season_id uuid NOT NULL
);


-- =====================================================
-- CONSTRAINTS
-- =====================================================

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_actor_player_id_fkey FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_event_type_check CHECK ((event_type = ANY (ARRAY['sportsbook_bet_placed'::text, 'sportsbook_parlay_placed'::text, 'sportsbook_big_ticket_placed'::text, 'sportsbook_big_win'::text, 'sportsbook_parlay_hit'::text, 'sportsbook_weekly_house_result'::text, 'loan_shark_loan_taken'::text, 'loan_shark_loan_repaid'::text, 'loan_shark_special_offer'::text, 'pvp_challenge_accepted'::text, 'pvp_challenge_settled'::text, 'bounty_board_bounty_posted'::text, 'bounty_board_hunter_joined'::text, 'bounty_board_bounty_closed'::text, 'bounty_board_sponsor_won'::text, 'bounty_board_hunters_won'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_pkey PRIMARY KEY (id);

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_pvp_challenge_id_fkey FOREIGN KEY (pvp_challenge_id) REFERENCES pvp_challenges(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_secondary_player_id_fkey FOREIGN KEY (secondary_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check CHECK ((source_feature = ANY (ARRAY['sportsbook'::text, 'loan_shark'::text, 'pvp'::text, 'bounty_board'::text, 'system'::text, 'admin'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_sportsbook_bet_id_fkey FOREIGN KEY (sportsbook_bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_status_check CHECK ((status = ANY (ARRAY['published'::text, 'suppressed'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_subject_player_id_fkey FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_suppressed_by_admin_id_fkey FOREIGN KEY (suppressed_by_admin_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'admin_only'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_one_source_check CHECK (((((((sportsbook_bet_id IS NOT NULL))::integer + ((loan_id IS NOT NULL))::integer) + ((pvp_challenge_id IS NOT NULL))::integer) + ((bounty_post_id IS NOT NULL))::integer) <= 1));

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_bet_id_selection_id_key UNIQUE (bet_id, selection_id);

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_odds_at_placement_check CHECK ((odds_at_placement > 1.0));

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_pkey PRIMARY KEY (id);

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text, 'push'::text, 'void'::text])));

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES bet_selections(id) ON DELETE CASCADE;

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_side_check CHECK ((side = ANY (ARRAY['back'::text, 'lay'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_created_by_player_id_fkey FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_game_number_check CHECK (((game_number IS NULL) OR (game_number >= 1)));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_market_type_check CHECK ((market_type = ANY (ARRAY['over_under'::text, 'moneyline'::text, 'prop'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_pkey PRIMARY KEY (id);

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'settled'::text, 'void'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_subject_game_id_fkey FOREIGN KEY (subject_game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_subject_player_id_fkey FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_back_bet_id_fkey FOREIGN KEY (back_bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_back_bet_id_key UNIQUE (back_bet_id);

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_lay_bet_id_fkey FOREIGN KEY (lay_bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_lay_bet_id_key UNIQUE (lay_bet_id);

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES bet_offers(id) ON DELETE SET NULL;

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_pkey PRIMARY KEY (id);

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_pool_check CHECK ((pool >= 0));

ALTER TABLE bet_matches ADD CONSTRAINT bet_matches_rake_check CHECK ((rake >= 0));

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_odds_check CHECK ((odds > 1.0));

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_pkey PRIMARY KEY (id);

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_proposer_id_fkey FOREIGN KEY (proposer_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_proposer_stake_check CHECK ((proposer_stake >= 10));

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES bet_selections(id) ON DELETE CASCADE;

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_status_check CHECK ((status = ANY (ARRAY['open'::text, 'accepted'::text, 'cancelled'::text, 'expired'::text])));

ALTER TABLE bet_offers ADD CONSTRAINT bet_offers_target_player_id_fkey FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_market_id_fkey FOREIGN KEY (market_id) REFERENCES bet_markets(id) ON DELETE CASCADE;

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_market_id_key_key UNIQUE (market_id, key);

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_odds_check CHECK ((odds > 1.0));

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_pkey PRIMARY KEY (id);

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text, 'push'::text, 'void'::text])));

ALTER TABLE bets ADD CONSTRAINT bets_counterparty_check CHECK ((counterparty = ANY (ARRAY['house'::text, 'peer'::text])));

ALTER TABLE bets ADD CONSTRAINT bets_pkey PRIMARY KEY (id);

ALTER TABLE bets ADD CONSTRAINT bets_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bets ADD CONSTRAINT bets_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE bets ADD CONSTRAINT bets_stake_check CHECK ((stake >= 10));

ALTER TABLE bets ADD CONSTRAINT bets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'won'::text, 'lost'::text, 'push'::text, 'void'::text, 'cancelled'::text])));

ALTER TABLE board_posts ADD CONSTRAINT board_posts_pkey PRIMARY KEY (id);

ALTER TABLE board_posts ADD CONSTRAINT board_posts_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_entry_number_check CHECK ((entry_number >= 1));

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_pkey PRIMARY KEY (id);

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_protected_hunter_profit_check CHECK ((protected_hunter_profit >= 0));

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_stake_amount_check CHECK ((stake_amount > 0));

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_stakes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'won'::text, 'lost'::text])));

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_unique_entry_number UNIQUE (bounty_post_id, entry_number);

ALTER TABLE bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_unique_player UNIQUE (bounty_post_id, player_id);

ALTER TABLE bounty_payouts ADD CONSTRAINT bounty_payouts_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE bounty_payouts ADD CONSTRAINT bounty_payouts_bounty_settlement_id_fkey FOREIGN KEY (bounty_settlement_id) REFERENCES bounty_settlements(id) ON DELETE CASCADE;

ALTER TABLE bounty_payouts ADD CONSTRAINT bounty_payouts_payout_amount_check CHECK ((payout_amount > 0));

ALTER TABLE bounty_payouts ADD CONSTRAINT bounty_payouts_pkey PRIMARY KEY (id);

ALTER TABLE bounty_payouts ADD CONSTRAINT bounty_payouts_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_bounty_type_check CHECK ((bounty_type = ANY (ARRAY['house_bounty'::text, 'sponsor_bounty'::text])));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_closes_after_create CHECK ((closes_at > created_at));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_house_seed_mode_check CHECK ((house_seed_mode = 'early_hunter_anti_dilution'::text));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_hunter_stake_amount_check CHECK ((hunter_stake_amount > 0));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_max_hunters_range CHECK (((max_hunters >= 1) AND (max_hunters <= 100)));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_pkey PRIMARY KEY (id);

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_reward_positive CHECK ((reward_per_hunter > 0));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_sponsor_bounty_amount_check CHECK ((sponsor_bounty_amount > 0));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_sponsor_consistency CHECK ((((bounty_type = 'house_bounty'::text) AND (sponsor_player_id IS NULL)) OR ((bounty_type = 'sponsor_bounty'::text) AND (sponsor_player_id IS NOT NULL))));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_sponsor_player_id_fkey FOREIGN KEY (sponsor_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'settled'::text])));

ALTER TABLE bounty_post ADD CONSTRAINT bounty_post_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE bounty_settlements ADD CONSTRAINT bounty_settlements_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE bounty_settlements ADD CONSTRAINT bounty_settlements_pkey PRIMARY KEY (id);

ALTER TABLE bounty_settlements ADD CONSTRAINT bounty_settlements_settled_by_admin_id_fkey FOREIGN KEY (settled_by_admin_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE bounty_settlements ADD CONSTRAINT bounty_settlements_settlement_outcome_check CHECK ((settlement_outcome = ANY (ARRAY['sponsor_win'::text, 'hunter_win'::text])));

ALTER TABLE bounty_settlements ADD CONSTRAINT bounty_settlements_settlement_source_check CHECK ((settlement_source = 'admin'::text));

ALTER TABLE games ADD CONSTRAINT game_schedule_pkey PRIMARY KEY (id);

ALTER TABLE games ADD CONSTRAINT games_distinct_teams_check CHECK ((team_a_id IS DISTINCT FROM team_b_id));

ALTER TABLE games ADD CONSTRAINT games_game_number_team_a_id_key UNIQUE (game_number, team_a_id);

ALTER TABLE games ADD CONSTRAINT games_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE games ADD CONSTRAINT games_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_pin_ledger_id_fkey FOREIGN KEY (pin_ledger_id) REFERENCES pin_ledger(id) ON DELETE SET NULL;

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_pkey PRIMARY KEY (id);

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_type_check CHECK ((type = ANY (ARRAY['loan_issued'::text, 'manual_repayment'::text, 'weekly_garnishment'::text, 'weekly_interest'::text, 'season_close_settlement'::text])));

ALTER TABLE loan_ledger ADD CONSTRAINT loan_ledger_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE loan_products ADD CONSTRAINT loan_products_borrow_amount_check CHECK ((borrow_amount > 0));

ALTER TABLE loan_products ADD CONSTRAINT loan_products_garnishment_rate_check CHECK (((garnishment_rate >= (0)::numeric) AND (garnishment_rate <= (1)::numeric)));

ALTER TABLE loan_products ADD CONSTRAINT loan_products_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0)));

ALTER TABLE loan_products ADD CONSTRAINT loan_products_pkey PRIMARY KEY (id);

ALTER TABLE loan_products ADD CONSTRAINT loan_products_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'extreme'::text])));

ALTER TABLE loan_products ADD CONSTRAINT loan_products_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id);

ALTER TABLE loan_products ADD CONSTRAINT loan_products_weekly_interest_rate_check CHECK ((weekly_interest_rate >= (0)::numeric));

ALTER TABLE loans ADD CONSTRAINT loans_loan_product_id_fkey FOREIGN KEY (loan_product_id) REFERENCES loan_products(id);

ALTER TABLE loans ADD CONSTRAINT loans_pkey PRIMARY KEY (id);

ALTER TABLE loans ADD CONSTRAINT loans_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE loans ADD CONSTRAINT loans_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE loans ADD CONSTRAINT loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paid_off'::text, 'season_closed'::text])));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bounty_hunter_stake_id_fkey FOREIGN KEY (bounty_hunter_stake_id) REFERENCES bounty_hunter_stakes(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bounty_payout_id_fkey FOREIGN KEY (bounty_payout_id) REFERENCES bounty_payouts(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bounty_settlement_id_fkey FOREIGN KEY (bounty_settlement_id) REFERENCES bounty_settlements(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_loan_ledger_id_fkey FOREIGN KEY (loan_ledger_id) REFERENCES loan_ledger(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_owner_chk CHECK ((is_house OR (player_id IS NOT NULL)));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_pkey PRIMARY KEY (id);

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_pvp_ledger_id_fkey FOREIGN KEY (pvp_ledger_id) REFERENCES pvp_ledger(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_type_check CHECK ((type = ANY (ARRAY['bonus'::text, 'score_credit'::text, 'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text, 'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text, 'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text, 'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text])));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE players ADD CONSTRAINT players_phone_e164 CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9]\d{6,14}$'::text)));

ALTER TABLE players ADD CONSTRAINT players_phone_key UNIQUE (phone);

ALTER TABLE players ADD CONSTRAINT players_pkey PRIMARY KEY (id);

ALTER TABLE players ADD CONSTRAINT players_role_check CHECK ((role = ANY (ARRAY['player'::text, 'admin'::text])));

ALTER TABLE players ADD CONSTRAINT players_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE players ADD CONSTRAINT players_user_id_key UNIQUE (user_id);

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES pvp_challenges(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_counterparty_stake_check CHECK ((counterparty_stake > 0));

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_creator_stake_check CHECK ((creator_stake > 0));

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_offer_no_check CHECK ((offer_no >= 1));

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_offered_by_player_id_fkey FOREIGN KEY (offered_by_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_pkey PRIMARY KEY (id);

ALTER TABLE pvp_challenge_offers ADD CONSTRAINT pvp_challenge_offers_prop_market_id_fkey FOREIGN KEY (prop_market_id) REFERENCES bet_markets(id) ON DELETE SET NULL;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_contract_type_check CHECK ((contract_type = ANY (ARRAY['line_duel'::text, 'prop_duel'::text, 'head_to_head'::text, 'custom'::text])));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_counterparty_player_id_fkey FOREIGN KEY (counterparty_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_counterparty_stake_check CHECK ((counterparty_stake > 0));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_creator_player_id_fkey FOREIGN KEY (creator_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_creator_stake_check CHECK ((creator_stake > 0));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_game_number_check CHECK (((game_number IS NULL) OR (game_number >= 1)));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_payout_amount_check CHECK ((payout_amount >= 0));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_pkey PRIMARY KEY (id);

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_prop_market_id_fkey FOREIGN KEY (prop_market_id) REFERENCES bet_markets(id) ON DELETE SET NULL;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_rematch_of_challenge_id_fkey FOREIGN KEY (rematch_of_challenge_id) REFERENCES pvp_challenges(id) ON DELETE SET NULL;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'countered'::text, 'accepted'::text, 'locked'::text, 'settled'::text, 'pushed'::text, 'voided'::text, 'cancelled'::text, 'expired'::text])));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_subject_player_id_fkey FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_total_pot_check CHECK ((total_pot > 0));

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;

ALTER TABLE pvp_challenges ADD CONSTRAINT pvp_challenges_winner_player_id_fkey FOREIGN KEY (winner_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES pvp_challenges(id) ON DELETE CASCADE;

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_pin_ledger_id_fkey FOREIGN KEY (pin_ledger_id) REFERENCES pin_ledger(id) ON DELETE SET NULL;

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_pkey PRIMARY KEY (id);

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_type_check CHECK ((type = ANY (ARRAY['stake'::text, 'payout'::text, 'refund'::text])));

ALTER TABLE pvp_ledger ADD CONSTRAINT pvp_ledger_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE registrations ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);

ALTER TABLE registrations ADD CONSTRAINT registrations_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_player_id_key UNIQUE (season_id, player_id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_pkey PRIMARY KEY (id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_status_check CHECK ((status = ANY (ARRAY['in'::text, 'out'::text])));

ALTER TABLE rsvp ADD CONSTRAINT rsvp_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_week_id_player_id_key UNIQUE (week_id, player_id);

ALTER TABLE scores ADD CONSTRAINT scores_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE scores ADD CONSTRAINT scores_pkey PRIMARY KEY (id);

ALTER TABLE scores ADD CONSTRAINT scores_team_slot_id_fkey FOREIGN KEY (team_slot_id) REFERENCES team_slots(id) ON DELETE CASCADE;

ALTER TABLE scores ADD CONSTRAINT scores_team_slot_id_game_id_key UNIQUE (team_slot_id, game_id);

ALTER TABLE season_champions ADD CONSTRAINT season_champions_pkey PRIMARY KEY (id);

ALTER TABLE season_champions ADD CONSTRAINT season_champions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id);

ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_id_player_id_key UNIQUE (season_id, player_id);

ALTER TABLE seasons ADD CONSTRAINT seasons_number_key UNIQUE (number);

ALTER TABLE seasons ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);

ALTER TABLE team_slots ADD CONSTRAINT team_slots_pkey PRIMARY KEY (id);

ALTER TABLE team_slots ADD CONSTRAINT team_slots_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE team_slots ADD CONSTRAINT team_slots_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE team_slots ADD CONSTRAINT team_slots_team_id_slot_key UNIQUE (team_id, slot);

ALTER TABLE teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE teams ADD CONSTRAINT teams_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;

ALTER TABLE teams ADD CONSTRAINT teams_week_id_team_number_key UNIQUE (week_id, team_number);

ALTER TABLE weeks ADD CONSTRAINT weeks_pkey PRIMARY KEY (id);

ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id);

ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_week_number_key UNIQUE (season_id, week_number);


-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX activity_feed_events_actor_player_id_idx ON public.activity_feed_events USING btree (actor_player_id);

CREATE INDEX activity_feed_events_bounty_idx ON public.activity_feed_events USING btree (bounty_post_id) WHERE (bounty_post_id IS NOT NULL);

CREATE INDEX activity_feed_events_feature_idx ON public.activity_feed_events USING btree (season_id, source_feature, status, visibility, published_at DESC, id DESC);

CREATE INDEX activity_feed_events_feed_idx ON public.activity_feed_events USING btree (season_id, status, visibility, published_at DESC, id DESC);

CREATE INDEX activity_feed_events_loan_idx ON public.activity_feed_events USING btree (loan_id) WHERE (loan_id IS NOT NULL);

CREATE INDEX activity_feed_events_pvp_challenge_idx ON public.activity_feed_events USING btree (pvp_challenge_id) WHERE (pvp_challenge_id IS NOT NULL);

CREATE INDEX activity_feed_events_secondary_player_id_idx ON public.activity_feed_events USING btree (secondary_player_id);

CREATE INDEX activity_feed_events_sportsbook_bet_idx ON public.activity_feed_events USING btree (sportsbook_bet_id) WHERE (sportsbook_bet_id IS NOT NULL);

CREATE INDEX activity_feed_events_subject_player_id_idx ON public.activity_feed_events USING btree (subject_player_id);

CREATE INDEX activity_feed_events_suppressed_by_admin_idx ON public.activity_feed_events USING btree (suppressed_by_admin_id);

CREATE INDEX activity_feed_events_week_id_idx ON public.activity_feed_events USING btree (week_id);

CREATE UNIQUE INDEX activity_feed_unique_bet_event ON public.activity_feed_events USING btree (sportsbook_bet_id, event_type) WHERE (sportsbook_bet_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_bounty_event ON public.activity_feed_events USING btree (bounty_post_id, event_type) WHERE (bounty_post_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_loan_event ON public.activity_feed_events USING btree (loan_id, event_type) WHERE (loan_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_pvp_event ON public.activity_feed_events USING btree (pvp_challenge_id, event_type) WHERE (pvp_challenge_id IS NOT NULL);

CREATE INDEX bounty_hunter_stakes_player_idx ON public.bounty_hunter_stakes USING btree (player_id, bounty_post_id);

CREATE INDEX bounty_payouts_player_idx ON public.bounty_payouts USING btree (player_id);

CREATE INDEX bounty_payouts_post_idx ON public.bounty_payouts USING btree (bounty_post_id);

CREATE INDEX bounty_payouts_settlement_idx ON public.bounty_payouts USING btree (bounty_settlement_id);

CREATE INDEX bounty_post_board_idx ON public.bounty_post USING btree (season_id, status, closes_at, created_at DESC);

CREATE INDEX bounty_post_season_id_idx ON public.bounty_post USING btree (season_id);

CREATE INDEX bounty_post_sponsor_idx ON public.bounty_post USING btree (sponsor_player_id) WHERE (sponsor_player_id IS NOT NULL);

CREATE INDEX bounty_post_week_board_idx ON public.bounty_post USING btree (week_id, status, closes_at);

CREATE INDEX bounty_post_week_id_idx ON public.bounty_post USING btree (week_id);

CREATE INDEX bounty_settlements_admin_idx ON public.bounty_settlements USING btree (settled_by_admin_id);

CREATE UNIQUE INDEX bounty_settlements_one_per_post ON public.bounty_settlements USING btree (bounty_post_id);

CREATE INDEX games_team_a_id_idx ON public.games USING btree (team_a_id);

CREATE INDEX games_team_b_id_idx ON public.games USING btree (team_b_id);

CREATE INDEX idx_bet_legs_bet ON public.bet_legs USING btree (bet_id);

CREATE INDEX idx_bet_legs_selection ON public.bet_legs USING btree (selection_id);

CREATE INDEX idx_bet_markets_created_by ON public.bet_markets USING btree (created_by_player_id);

CREATE INDEX idx_bet_markets_status ON public.bet_markets USING btree (status);

CREATE INDEX idx_bet_markets_subject ON public.bet_markets USING btree (subject_player_id);

CREATE INDEX idx_bet_markets_subject_game ON public.bet_markets USING btree (subject_game_id);

CREATE INDEX idx_bet_markets_week ON public.bet_markets USING btree (week_id);

CREATE INDEX idx_bet_matches_offer ON public.bet_matches USING btree (offer_id);

CREATE INDEX idx_bet_offers_accepted_by ON public.bet_offers USING btree (accepted_by);

CREATE INDEX idx_bet_offers_proposer ON public.bet_offers USING btree (proposer_id);

CREATE INDEX idx_bet_offers_season ON public.bet_offers USING btree (season_id);

CREATE INDEX idx_bet_offers_selection ON public.bet_offers USING btree (selection_id);

CREATE INDEX idx_bet_offers_status ON public.bet_offers USING btree (status);

CREATE INDEX idx_bet_offers_target ON public.bet_offers USING btree (target_player_id);

CREATE INDEX idx_bet_selections_market ON public.bet_selections USING btree (market_id);

CREATE INDEX idx_bets_player_season ON public.bets USING btree (player_id, season_id);

CREATE INDEX idx_bets_season ON public.bets USING btree (season_id);

CREATE INDEX idx_bets_status ON public.bets USING btree (status);

CREATE INDEX idx_pin_ledger_bet ON public.pin_ledger USING btree (bet_id);

CREATE INDEX idx_pin_ledger_house ON public.pin_ledger USING btree (season_id) WHERE is_house;

CREATE INDEX idx_pin_ledger_player_season ON public.pin_ledger USING btree (player_id, season_id);

CREATE INDEX idx_pin_ledger_season ON public.pin_ledger USING btree (season_id);

CREATE INDEX loan_ledger_loan_id_idx ON public.loan_ledger USING btree (loan_id);

CREATE INDEX loan_ledger_pin_ledger_id_idx ON public.loan_ledger USING btree (pin_ledger_id);

CREATE INDEX loan_ledger_player_id_idx ON public.loan_ledger USING btree (player_id);

CREATE INDEX loan_ledger_season_id_idx ON public.loan_ledger USING btree (season_id);

CREATE INDEX loan_ledger_week_id_idx ON public.loan_ledger USING btree (week_id);

CREATE INDEX loan_products_season_id_idx ON public.loan_products USING btree (season_id);

CREATE INDEX loans_loan_product_id_idx ON public.loans USING btree (loan_product_id);

CREATE INDEX loans_player_id_idx ON public.loans USING btree (player_id);

CREATE INDEX loans_season_id_idx ON public.loans USING btree (season_id);

CREATE INDEX pin_ledger_bounty_hunter_stake_id_idx ON public.pin_ledger USING btree (bounty_hunter_stake_id);

CREATE INDEX pin_ledger_bounty_payout_id_idx ON public.pin_ledger USING btree (bounty_payout_id);

CREATE INDEX pin_ledger_bounty_post_id_idx ON public.pin_ledger USING btree (bounty_post_id);

CREATE INDEX pin_ledger_bounty_settlement_id_idx ON public.pin_ledger USING btree (bounty_settlement_id);

CREATE INDEX pin_ledger_loan_ledger_id_idx ON public.pin_ledger USING btree (loan_ledger_id);

CREATE INDEX pin_ledger_pvp_ledger_id_idx ON public.pin_ledger USING btree (pvp_ledger_id);

CREATE INDEX pin_ledger_week_id_idx ON public.pin_ledger USING btree (week_id);

CREATE INDEX pvp_challenge_offers_challenge_id_idx ON public.pvp_challenge_offers USING btree (challenge_id);

CREATE INDEX pvp_challenge_offers_live_offer_idx ON public.pvp_challenge_offers USING btree (challenge_id) WHERE ((superseded_at IS NULL) AND (accepted_at IS NULL) AND (declined_at IS NULL));

CREATE INDEX pvp_challenge_offers_offered_by_player_id_idx ON public.pvp_challenge_offers USING btree (offered_by_player_id);

CREATE INDEX pvp_challenges_counterparty_player_id_idx ON public.pvp_challenges USING btree (counterparty_player_id);

CREATE INDEX pvp_challenges_creator_player_id_idx ON public.pvp_challenges USING btree (creator_player_id);

CREATE INDEX pvp_challenges_prop_market_id_idx ON public.pvp_challenges USING btree (prop_market_id);

CREATE INDEX pvp_challenges_rematch_of_challenge_id_idx ON public.pvp_challenges USING btree (rematch_of_challenge_id);

CREATE INDEX pvp_challenges_season_id_idx ON public.pvp_challenges USING btree (season_id);

CREATE INDEX pvp_challenges_subject_player_id_idx ON public.pvp_challenges USING btree (subject_player_id);

CREATE INDEX pvp_challenges_week_id_idx ON public.pvp_challenges USING btree (week_id);

CREATE INDEX pvp_challenges_winner_player_id_idx ON public.pvp_challenges USING btree (winner_player_id);

CREATE INDEX pvp_ledger_challenge_id_idx ON public.pvp_ledger USING btree (challenge_id);

CREATE INDEX pvp_ledger_pin_ledger_id_idx ON public.pvp_ledger USING btree (pin_ledger_id);

CREATE INDEX pvp_ledger_player_id_idx ON public.pvp_ledger USING btree (player_id);

CREATE INDEX pvp_ledger_season_id_idx ON public.pvp_ledger USING btree (season_id);

CREATE INDEX pvp_ledger_week_id_idx ON public.pvp_ledger USING btree (week_id);

CREATE INDEX registrations_player_id_idx ON public.registrations USING btree (player_id);

CREATE INDEX registrations_season_id_idx ON public.registrations USING btree (season_id);

CREATE UNIQUE INDEX seasons_single_active ON public.seasons USING btree (is_active) WHERE is_active;

CREATE INDEX team_slots_team_id_idx ON public.team_slots USING btree (team_id);


-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE activity_feed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON activity_feed_events AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON activity_feed_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can read all" ON activity_feed_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON activity_feed_events AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read public published" ON activity_feed_events AS PERMISSIVE FOR SELECT TO anon
  USING (((status = 'published'::text) AND (visibility = 'public'::text)));

CREATE POLICY "authenticated can read public published" ON activity_feed_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((status = 'published'::text) AND (visibility = 'public'::text)));

ALTER TABLE bet_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_legs AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bet_legs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bet_legs AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bet_legs AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bet_legs AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_markets AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bet_markets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bet_markets AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bet_markets AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bet_markets AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_matches AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bet_matches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bet_matches AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bet_matches AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bet_matches AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_offers AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bet_offers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bet_offers AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bet_offers AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bet_offers AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_selections AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bet_selections AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bet_selections AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bet_selections AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bet_selections AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bets AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bets AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bets AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bets AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE board_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can delete own" ON board_posts AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

CREATE POLICY "authenticated can insert" ON board_posts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "authenticated can read" ON board_posts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_hunter_stakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_hunter_stakes AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bounty_hunter_stakes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bounty_hunter_stakes AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bounty_hunter_stakes AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bounty_hunter_stakes AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_payouts AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bounty_payouts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bounty_payouts AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bounty_payouts AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bounty_payouts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_post ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_post AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bounty_post AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bounty_post AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bounty_post AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bounty_post AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_settlements AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON bounty_settlements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON bounty_settlements AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON bounty_settlements AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON bounty_settlements AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON games AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON games AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON games AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loan_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loan_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON loan_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON loan_ledger AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON loan_ledger AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON loan_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loan_products AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON loan_products AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON loan_products AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON loan_products AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON loan_products AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loans AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON loans AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON loans AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON loans AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON loans AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pin_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON pin_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON pin_ledger AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON pin_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can insert" ON players AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON players AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON players AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pvp_challenge_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_challenge_offers AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON pvp_challenge_offers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON pvp_challenge_offers AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON pvp_challenge_offers AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON pvp_challenge_offers AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pvp_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_challenges AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON pvp_challenges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON pvp_challenges AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON pvp_challenges AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON pvp_challenges AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pvp_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON pvp_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON pvp_ledger AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "anon can read" ON pvp_ledger AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON pvp_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY registrations_delete ON registrations AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

CREATE POLICY registrations_insert ON registrations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

CREATE POLICY registrations_select ON registrations AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY registrations_update ON registrations AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

ALTER TABLE rsvp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage rsvp" ON rsvp AS PERMISSIVE FOR ALL TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON rsvp AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "player can manage own rsvp" ON rsvp AS PERMISSIVE FOR ALL TO authenticated
  USING ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON scores AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON scores AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON scores AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON scores AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE season_champions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON season_champions AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON season_champions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON season_champions AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON seasons AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON seasons AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON seasons AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON seasons AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE team_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON team_slots AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON team_slots AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON team_slots AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON team_slots AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON teams AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can insert" ON teams AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON teams AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON teams AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can insert" ON weeks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "admin can update" ON weeks AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "authenticated can read" ON weeks AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);


-- =====================================================
-- FUNCTIONS & PROCEDURES
-- =====================================================

CREATE OR REPLACE FUNCTION public.accept_pvp_challenge(p_challenge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_id      uuid;
  v_challenge      public.pvp_challenges;
  v_offer          record;
  v_creator_bal    int;
  v_cparty_bal     int;
  v_pin_p1_player  uuid;
  v_pin_p1_house   uuid;
  v_pin_p2_player  uuid;
  v_pin_p2_house   uuid;
  v_pvp_stake1     uuid;
  v_pvp_stake2     uuid;
  v_counterparty   uuid;
BEGIN
  SELECT id INTO v_caller_id FROM public.players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Challenge is not in an acceptable state';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot accept your own offer';
  END IF;

  IF v_challenge.counterparty_player_id IS NULL THEN
    v_counterparty := v_caller_id;
  ELSE
    IF v_caller_id <> v_challenge.counterparty_player_id
       AND v_caller_id <> v_challenge.creator_player_id THEN
      RAISE EXCEPTION 'You are not a party to this challenge';
    END IF;
    v_counterparty := v_challenge.counterparty_player_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.weeks WHERE id = v_challenge.week_id AND is_archived = true) THEN
    RAISE EXCEPTION 'Cannot accept a contract for an archived week';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_creator_bal
    FROM public.pin_ledger WHERE player_id = v_challenge.creator_player_id AND season_id = v_challenge.season_id;
  IF v_creator_bal < v_challenge.creator_stake THEN
    RAISE EXCEPTION 'Creator has insufficient balance';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cparty_bal
    FROM public.pin_ledger WHERE player_id = v_counterparty AND season_id = v_challenge.season_id;
  IF v_cparty_bal < v_challenge.counterparty_stake THEN
    RAISE EXCEPTION 'Counterparty has insufficient balance';
  END IF;

  -- Escrow creator's stake (double-entry: player -stake, house +stake).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            false, -v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed')
    RETURNING id INTO v_pin_p1_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed (house)')
    RETURNING id INTO v_pin_p1_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.creator_stake, 'stake', 'Creator stake escrowed', v_pin_p1_player)
    RETURNING id INTO v_pvp_stake1;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake1 WHERE id IN (v_pin_p1_player, v_pin_p1_house);

  -- Escrow counterparty's stake.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_counterparty, v_challenge.season_id, v_challenge.week_id,
            false, -v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed')
    RETURNING id INTO v_pin_p2_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed (house)')
    RETURNING id INTO v_pin_p2_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_counterparty, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.counterparty_stake, 'stake', 'Counterparty stake escrowed', v_pin_p2_player)
    RETURNING id INTO v_pvp_stake2;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake2 WHERE id IN (v_pin_p2_player, v_pin_p2_house);

  IF v_challenge.contract_type = 'line_duel' THEN
    UPDATE public.pvp_challenges SET
      creator_line      = COALESCE(creator_line, public.pvp_player_line(v_challenge.creator_player_id, v_challenge.season_id)),
      counterparty_line = COALESCE(counterparty_line, public.pvp_player_line(v_counterparty, v_challenge.season_id))
    WHERE id = p_challenge_id;
  END IF;

  UPDATE public.pvp_challenge_offers SET accepted_at = now() WHERE id = v_offer.id;

  UPDATE public.pvp_challenges SET
    status                 = 'locked',
    counterparty_player_id = v_counterparty,
    accepted_at            = now(),
    locked_at              = now(),
    total_pot              = v_challenge.creator_stake + v_challenge.counterparty_stake,
    payout_amount          = v_challenge.creator_stake + v_challenge.counterparty_stake
  WHERE id = p_challenge_id;

  -- Activity Feed: the contract is locked between two players. Actor = creator,
  -- secondary = the opponent. Pot is public (shown on the Challenge Board).
  PERFORM public.publish_activity_event(
    'pvp', 'pvp_challenge_accepted',
    v_challenge.season_id, v_challenge.week_id,
    v_challenge.creator_player_id, NULL, v_counterparty,
    NULL, NULL,
    'pvp.challenge_accepted',
    jsonb_build_object('pot', v_challenge.creator_stake + v_challenge.counterparty_stake,
                       'contract_type', v_challenge.contract_type),
    jsonb_build_object('challenge_id', p_challenge_id),
    NULL, now(),
    p_challenge_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market_ids uuid[];
  v_mid        uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Markets this bet touched (captured before the bet is deleted).
  SELECT ARRAY_AGG(DISTINCT s.market_id) INTO v_market_ids
  FROM public.bet_legs l
  JOIN public.bet_selections s ON s.id = l.selection_id
  WHERE l.bet_id = p_bet_id;

  DELETE FROM public.pin_ledger WHERE bet_id = p_bet_id;
  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Re-open any settled market that now has no bets at all.
  IF v_market_ids IS NOT NULL THEN
    FOREACH v_mid IN ARRAY v_market_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        WHERE s.market_id = v_mid
      ) AND EXISTS (
        SELECT 1 FROM public.bet_markets WHERE id = v_mid AND status = 'settled'
      ) THEN
        UPDATE public.bet_markets
          SET status = 'open', result_value = NULL, settled_at = NULL
          WHERE id = v_mid;
        UPDATE public.bet_selections SET result = NULL WHERE market_id = v_mid;
      END IF;
    END LOOP;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_bounty(p_bounty_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  -- Delete all bounty pin rows first (they are ON DELETE CASCADE against
  -- bounty_post, but deleting by bounty_post_id catches both sides of every pair
  -- regardless of the granular FK columns).
  DELETE FROM public.pin_ledger WHERE bounty_post_id = p_bounty_post_id;

  -- Delete the root; hunter_stakes, settlements, payouts, and activity_feed_events
  -- rows all cascade ON DELETE CASCADE from bounty_post.
  DELETE FROM public.bounty_post WHERE id = p_bounty_post_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_loan(p_loan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  DELETE FROM public.pin_ledger
   WHERE loan_ledger_id IN (SELECT id FROM public.loan_ledger WHERE loan_id = p_loan_id);

  DELETE FROM public.loan_ledger WHERE loan_id = p_loan_id;
  DELETE FROM public.loans WHERE id = p_loan_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_pvp_challenge(p_challenge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_challenge public.pvp_challenges;
  v_is_admin  boolean;
  v_caller    uuid;
BEGIN
  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';

  -- Player path: must be the author, and the contract must still be open. Admins
  -- bypass both checks (they can cancel pending/countered/locked contracts).
  IF NOT v_is_admin THEN
    SELECT id INTO v_caller FROM public.players WHERE user_id = auth.uid();
    IF v_challenge.creator_player_id <> v_caller THEN
      RAISE EXCEPTION 'Not your challenge';
    END IF;
    IF v_challenge.status NOT IN ('pending', 'countered') THEN
      RAISE EXCEPTION 'Only open challenges can be cancelled';
    END IF;
  END IF;

  -- Delete the escrow pin rows (both player + house sides) linked through this
  -- challenge's pvp_ledger entries. pin_ledger.pvp_ledger_id is ON DELETE SET
  -- NULL, so these must go before the contract is removed or they orphan.
  DELETE FROM public.pin_ledger
    WHERE pvp_ledger_id IN (
      SELECT id FROM public.pvp_ledger WHERE challenge_id = p_challenge_id
    );

  -- Delete the contract; pvp_ledger and pvp_challenge_offers cascade.
  DELETE FROM public.pvp_challenges WHERE id = p_challenge_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.close_bounty(p_bounty_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Only an open bounty can be closed';
  END IF;

  UPDATE public.bounty_post SET status = 'closed' WHERE id = p_bounty_post_id;

  -- Activity Feed: the bounty is locked for entries. No player actor.
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_closed',
    v_bounty.season_id, v_bounty.week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_closed',
    jsonb_build_object('bounty_title', v_bounty.title),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, now(),
    NULL, p_bounty_post_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.close_open_pvp_challenges(p_week_id uuid, p_game_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Stamp the live offer for each in-scope challenge as declined.
  UPDATE public.pvp_challenge_offers o
    SET declined_at = now()
    WHERE o.superseded_at IS NULL AND o.accepted_at IS NULL AND o.declined_at IS NULL
      AND o.challenge_id IN (
        SELECT c.id FROM public.pvp_challenges c
        WHERE c.week_id = p_week_id
          AND c.status IN ('pending', 'countered')
          AND (p_game_number IS NULL OR c.game_number = p_game_number)
      );

  -- Close the challenges themselves.
  UPDATE public.pvp_challenges c
    SET status = 'cancelled'
    WHERE c.week_id = p_week_id
      AND c.status IN ('pending', 'countered')
      AND (p_game_number IS NULL OR c.game_number = p_game_number);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.counter_pvp_challenge(p_challenge_id uuid, p_creator_stake integer, p_counterparty_stake integer, p_contract_type text, p_game_number integer, p_prop_market_id uuid, p_selection text, p_message text, p_creator_handicap integer, p_counterparty_handicap integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_id             uuid;
  v_challenge             public.pvp_challenges;
  v_offer                 record;
  v_next_offer_no         int;
  v_total_pot             int;
  v_counterparty_sel      text;
  v_subject_id            uuid;
  v_game_number           int;
  v_my_stake              int;
  v_resolved_cparty       uuid;
  v_creator_line          numeric;
  v_counterparty_line     numeric;
  v_creator_handicap      int := 0;
  v_counterparty_handicap int := 0;
BEGIN
  SELECT id INTO v_caller_id FROM public.players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Challenge is not in a negotiable state';
  END IF;
  IF v_challenge.counterparty_player_id IS NOT NULL
     AND v_caller_id <> v_challenge.creator_player_id
     AND v_caller_id <> v_challenge.counterparty_player_id THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot counter your own offer — wait for the other party';
  END IF;

  -- Both stakes must clear the floor; balance-check only the caller's own side
  -- (creator side if the caller is the creator, otherwise the counterparty side).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  v_my_stake := CASE WHEN v_caller_id = v_challenge.creator_player_id
                     THEN p_creator_stake ELSE p_counterparty_stake END;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_caller_id AND season_id = v_challenge.season_id;
    IF v_balance < v_my_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'head_to_head') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and head_to_head';
    END IF;
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    IF p_selection IS NULL THEN
      RAISE EXCEPTION 'selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets WHERE id = p_prop_market_id AND status = 'open'
    ) THEN
      RAISE EXCEPTION 'Prop market not found or not open';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections WHERE market_id = p_prop_market_id AND key = p_selection
    ) THEN
      RAISE EXCEPTION 'selection is not a valid key for this market';
    END IF;
    SELECT key INTO v_counterparty_sel
      FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key <> p_selection LIMIT 1;
    SELECT subject_player_id INTO v_subject_id
      FROM public.bet_markets WHERE id = p_prop_market_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form: no game/market. Title/description remain as the creator set them.
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
    v_game_number      := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- Resolve who the counterparty is after this counter (an open board is taken by
  -- the caller), then (re)snapshot Line Duel lines for both current parties.
  v_resolved_cparty := CASE
    WHEN v_challenge.counterparty_player_id IS NULL AND v_caller_id <> v_challenge.creator_player_id
      THEN v_caller_id
    ELSE v_challenge.counterparty_player_id
  END;

  IF p_contract_type = 'line_duel' THEN
    v_creator_line := public.pvp_player_line(v_challenge.creator_player_id, v_challenge.season_id);
    IF v_resolved_cparty IS NOT NULL THEN
      v_counterparty_line := public.pvp_player_line(v_resolved_cparty, v_challenge.season_id);
    END IF;
  END IF;

  -- Head-to-Head handicaps are renegotiated like the stakes (role-fixed). Forced
  -- to 0 for every other type.
  IF p_contract_type = 'head_to_head' THEN
    v_creator_handicap      := COALESCE(p_creator_handicap, 0);
    v_counterparty_handicap := COALESCE(p_counterparty_handicap, 0);
  END IF;

  -- Winner takes the whole pot.
  v_total_pot := p_creator_stake + p_counterparty_stake;
  v_next_offer_no := v_offer.offer_no + 1;

  UPDATE public.pvp_challenge_offers SET superseded_at = now() WHERE id = v_offer.id;

  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    p_challenge_id, v_caller_id, v_next_offer_no, p_contract_type,
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_selection, v_counterparty_sel,
    p_message
  );

  UPDATE public.pvp_challenges SET
    status                 = 'countered',
    contract_type          = p_contract_type,
    creator_stake          = p_creator_stake,
    counterparty_stake     = p_counterparty_stake,
    total_pot              = v_total_pot,
    payout_amount          = v_total_pot,
    game_number            = v_game_number,
    creator_line           = v_creator_line,
    counterparty_line      = v_counterparty_line,
    creator_handicap       = v_creator_handicap,
    counterparty_handicap  = v_counterparty_handicap,
    prop_market_id         = p_prop_market_id,
    creator_selection      = CASE WHEN p_contract_type = 'prop_duel' THEN p_selection        ELSE NULL END,
    counterparty_selection = CASE WHEN p_contract_type = 'prop_duel' THEN v_counterparty_sel ELSE NULL END,
    subject_player_id      = v_subject_id,
    counterparty_player_id = v_resolved_cparty
  WHERE id = p_challenge_id;

  RETURN p_challenge_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_house_bounty(p_week_id uuid, p_title text, p_description text, p_reward_per_hunter integer, p_hunter_stake_amount integer, p_max_hunters integer, p_closes_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_bounty_id uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  IF p_week_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.weeks
      WHERE id = p_week_id AND season_id = v_season_id AND is_archived = false
    ) THEN
      RAISE EXCEPTION 'Invalid or archived week';
    END IF;
  END IF;

  IF length(coalesce(p_title, '')) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF length(coalesce(p_description, '')) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_reward_per_hunter < 25 THEN
    RAISE EXCEPTION 'Reward per hunter must be at least 25 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_max_hunters < 1 OR p_max_hunters > 100 THEN
    RAISE EXCEPTION 'Max hunters must be between 1 and 100';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'house_bounty', NULL, p_title, p_description,
    p_reward_per_hunter * p_max_hunters, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- No ledger movement — the House funds rewards only if hunters win (design §23.4).

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'house_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_pvp_challenge(p_contract_type text, p_counterparty_player_id uuid, p_week_id uuid, p_game_number integer, p_creator_stake integer, p_counterparty_stake integer, p_prop_market_id uuid, p_creator_selection text, p_message text, p_custom_title text, p_custom_description text, p_creator_handicap integer, p_counterparty_handicap integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_creator_id            uuid;
  v_season_id             uuid;
  v_week                  record;
  v_total_pot             int;
  v_counterparty_sel      text;
  v_subject_player_id     uuid;
  v_game_number           int;
  v_challenge_id          uuid;
  v_market                record;
  v_creator_line          numeric;
  v_counterparty_line     numeric;
  v_creator_handicap      int := 0;
  v_counterparty_handicap int := 0;
BEGIN
  -- 1. Resolve caller.
  SELECT id INTO v_creator_id FROM public.players WHERE user_id = auth.uid();
  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  -- 2. Resolve current season and validate week.
  SELECT id INTO v_season_id FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL OR v_week.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Week not found in current season';
  END IF;
  IF v_week.is_archived THEN
    RAISE EXCEPTION 'Cannot create a contract for an archived week';
  END IF;

  -- 3. Validate stakes. Both sides must clear the 10-pin floor; only the creator's
  --    balance is checked here (the counterparty's is checked at accept time).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_creator_id AND season_id = v_season_id;
    IF v_balance < p_creator_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  -- 4. Validate counterparty and contract-type scope.
  IF p_counterparty_player_id IS NOT NULL THEN
    IF p_counterparty_player_id = v_creator_id THEN
      RAISE EXCEPTION 'Cannot challenge yourself';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_counterparty_player_id) THEN
      RAISE EXCEPTION 'Counterparty player not found';
    END IF;
  END IF;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'head_to_head') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and head_to_head';
    END IF;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    SELECT * INTO v_market
      FROM public.bet_markets
      WHERE id = p_prop_market_id;
    IF v_market.id IS NULL THEN
      RAISE EXCEPTION 'Prop market not found';
    END IF;
    IF v_market.status <> 'open' THEN
      RAISE EXCEPTION 'Prop market is not open';
    END IF;
    IF p_creator_selection IS NULL THEN
      RAISE EXCEPTION 'creator_selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key = p_creator_selection
    ) THEN
      RAISE EXCEPTION 'creator_selection is not a valid key for this market';
    END IF;
    SELECT key INTO v_counterparty_sel
      FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key <> p_creator_selection
      LIMIT 1;
    IF v_counterparty_sel IS NULL THEN
      RAISE EXCEPTION 'Could not derive counterparty selection for prop_duel';
    END IF;
    v_subject_player_id := v_market.subject_player_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form, week-level: no game, no market. The win condition is the text.
    IF p_custom_title IS NULL OR length(trim(p_custom_title)) = 0
       OR p_custom_description IS NULL OR length(trim(p_custom_description)) = 0 THEN
      RAISE EXCEPTION 'Custom contracts require a title and a win-condition description';
    END IF;
    v_game_number := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- 4b. Snapshot Line Duel lines now so the terms are visible during negotiation.
  --     Creator's line is always known; the counterparty's is known only for a
  --     named opponent (open board fills it when a taker engages).
  IF p_contract_type = 'line_duel' THEN
    v_creator_line := public.pvp_player_line(v_creator_id, v_season_id);
    IF p_counterparty_player_id IS NOT NULL THEN
      v_counterparty_line := public.pvp_player_line(p_counterparty_player_id, v_season_id);
    END IF;
  END IF;

  -- 4c. Head-to-Head handicaps are creator-defined terms (signed pins, 0 = none),
  --     known for both sides up front even on an open board. Forced to 0 otherwise.
  IF p_contract_type = 'head_to_head' THEN
    v_creator_handicap      := COALESCE(p_creator_handicap, 0);
    v_counterparty_handicap := COALESCE(p_counterparty_handicap, 0);
  END IF;

  -- 5. Compute financials and insert challenge. Winner takes the whole pot.
  v_total_pot := p_creator_stake + p_counterparty_stake;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, payout_amount,
    creator_line, counterparty_line,
    creator_handicap, counterparty_handicap,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    creator_message, custom_title, custom_description
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, v_game_number,
    p_creator_stake, p_counterparty_stake, v_total_pot, v_total_pot,
    v_creator_line, v_counterparty_line,
    v_creator_handicap, v_counterparty_handicap,
    p_prop_market_id, p_creator_selection, v_counterparty_sel, v_subject_player_id,
    p_message,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_title)       ELSE NULL END,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_description) ELSE NULL END
  ) RETURNING id INTO v_challenge_id;

  -- 6. Insert the original offer (offer_no = 1, snapshot of terms).
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    v_challenge_id, v_creator_id, 1, p_contract_type,
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    p_message
  );

  RETURN v_challenge_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_sponsor_bounty(p_week_id uuid, p_title text, p_description text, p_reward_per_hunter integer, p_hunter_stake_amount integer, p_max_hunters integer, p_closes_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sponsor_id uuid;
  v_season_id  uuid;
  v_balance    int;
  v_escrow     int;
  v_bounty_id  uuid;
BEGIN
  SELECT id INTO v_sponsor_id FROM public.players WHERE user_id = auth.uid();
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  IF p_week_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.weeks
      WHERE id = p_week_id AND season_id = v_season_id AND is_archived = false
    ) THEN
      RAISE EXCEPTION 'Invalid or archived week';
    END IF;
  END IF;

  IF length(coalesce(p_title, '')) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF length(coalesce(p_description, '')) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_reward_per_hunter < 25 THEN
    RAISE EXCEPTION 'Reward per hunter must be at least 25 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_max_hunters < 1 OR p_max_hunters > 100 THEN
    RAISE EXCEPTION 'Max hunters must be between 1 and 100';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  v_escrow := p_reward_per_hunter * p_max_hunters;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_sponsor_id AND season_id = v_season_id;
  IF v_balance < v_escrow THEN
    RAISE EXCEPTION 'Insufficient balance: sponsoring up to % hunters at % each requires % pins',
      p_max_hunters, p_reward_per_hunter, v_escrow;
  END IF;

  -- sponsor_bounty_amount holds the TOTAL escrow (R*m) so the escrow plumbing and
  -- cancel/refund-by-bounty_post_id logic are unchanged.
  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'sponsor_bounty', v_sponsor_id, p_title, p_description,
    v_escrow, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- Escrow the full max liability (player -R*m, house +R*m). Both rows carry
  -- bounty_post_id so cancel deletes them together.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (v_sponsor_id, v_season_id, p_week_id, false, -v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed', v_bounty_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (NULL, v_season_id, p_week_id, true, v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed (house)', v_bounty_id);

  -- Activity Feed: a sponsor bounty is on the board. Actor = sponsor (leads the card).
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    v_sponsor_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'sponsor_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_system_activity_event(p_source_feature text, p_event_type text, p_template_key text, p_public_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_week_id   uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  -- Week is optional — latest non-archived week of the current season.
  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  RETURN public.publish_activity_event(
    p_source_feature, p_event_type,
    v_season_id, v_week_id, NULL, NULL, NULL, NULL, NULL,
    p_template_key, p_public_payload, '{}'::jsonb,
    'public', now());
END;
$function$
;

CREATE OR REPLACE FUNCTION public.custom_access_token(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claims     jsonb;
  user_role  text;
BEGIN
  SELECT role INTO user_role
  FROM players
  WHERE user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::jsonb)
      || jsonb_build_object('role', COALESCE(user_role, 'player'))
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.decline_pvp_challenge(p_challenge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid;
  v_challenge public.pvp_challenges;
  v_offer     record;
BEGIN
  SELECT id INTO v_caller_id FROM public.players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Challenge is not in a declinable state';
  END IF;

  -- Caller must be a party: the creator, or the (set) counterparty. An open-board
  -- contract has no counterparty yet, so only the creator is a party — and the
  -- creator cannot decline their own live offer (guarded below), which means an
  -- open-board contract is never declinable by a stranger.
  IF v_caller_id <> v_challenge.creator_player_id
     AND (v_challenge.counterparty_player_id IS NULL
          OR v_caller_id <> v_challenge.counterparty_player_id) THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  -- Caller must be the offer recipient (the other party), not the offerer.
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot decline your own offer';
  END IF;

  UPDATE public.pvp_challenge_offers SET declined_at = now() WHERE id = v_offer.id;
  UPDATE public.pvp_challenges SET status = 'cancelled' WHERE id = p_challenge_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_audit_columns()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  obj record;
  tbl_name text;
  has_updated_at boolean;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE'
  LOOP
    IF obj.schema_name <> 'public' THEN CONTINUE; END IF;
    tbl_name := (SELECT relname FROM pg_class WHERE oid = obj.objid);

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name  = tbl_name
        AND column_name = 'created_at'
    ) THEN
      RAISE EXCEPTION 'Table % must include a created_at column', obj.object_identity;
    END IF;

    has_updated_at := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name  = tbl_name
        AND column_name = 'updated_at'
    );

    IF NOT has_updated_at THEN
      RAISE EXCEPTION 'Table % must include an updated_at column', obj.object_identity;
    END IF;

    -- Auto-attach the shared updated_at trigger if it isn't already present.
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = obj.objid
        AND tgname  = 'set_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        tbl_name
      );
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enter_bounty_as_hunter(p_bounty_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_hunter_id    uuid;
  v_bounty       public.bounty_post;
  v_balance      int;
  v_entry_number int;
  v_count        int;
  v_stake_id     uuid;
BEGIN
  SELECT id INTO v_hunter_id FROM public.players WHERE user_id = auth.uid();
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  -- Serialize concurrent entries so entry_number + capacity are deterministic.
  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Bounty is not open for entries';
  END IF;
  IF now() >= v_bounty.closes_at THEN
    RAISE EXCEPTION 'Bounty has closed';
  END IF;

  IF v_bounty.bounty_type = 'sponsor_bounty' AND v_bounty.sponsor_player_id = v_hunter_id THEN
    RAISE EXCEPTION 'You cannot hunt your own bounty';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_hunter_stakes
    WHERE bounty_post_id = p_bounty_post_id AND player_id = v_hunter_id
  ) THEN
    RAISE EXCEPTION 'You have already entered this bounty';
  END IF;

  -- Capacity: the sponsor has only escrowed reward for max_hunters hunters.
  SELECT count(*) INTO v_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_count >= v_bounty.max_hunters THEN
    RAISE EXCEPTION 'Bounty is full';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_hunter_id AND season_id = v_bounty.season_id;
  IF v_balance < v_bounty.hunter_stake_amount THEN
    RAISE EXCEPTION 'Insufficient balance to enter this bounty';
  END IF;

  v_entry_number := v_count + 1;

  -- Every hunter is offered the same fixed reward (no dilution). protected_hunter_profit
  -- now snapshots the flat reward_per_hunter (kept on the row for settlement + display).
  INSERT INTO public.bounty_hunter_stakes (
    bounty_post_id, player_id, stake_amount, entry_number, protected_hunter_profit, status
  ) VALUES (
    p_bounty_post_id, v_hunter_id, v_bounty.hunter_stake_amount, v_entry_number,
    v_bounty.reward_per_hunter, 'active'
  )
  RETURNING id INTO v_stake_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (v_hunter_id, v_bounty.season_id, v_bounty.week_id, false, -v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed', p_bounty_post_id, v_stake_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed (house)', p_bounty_post_id, v_stake_id);

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_hunter_joined',
    v_bounty.season_id, v_bounty.week_id,
    v_hunter_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.hunter_joined',
    jsonb_build_object('bounty_title', v_bounty.title, 'entry_number', v_entry_number),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, now(),
    NULL, p_bounty_post_id);

  RETURN v_stake_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_bets_for_market(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bet    record;
  v_leg    record;
  v_odds   numeric;
  v_payout integer;
BEGIN
  FOR v_bet IN
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
    FROM public.bets b
    JOIN public.bet_legs       l ON l.bet_id = b.id
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id AND b.status = 'pending'
  LOOP
    -- Copy result onto every now-resolved leg of this bet (back/lay truth table).
    UPDATE public.bet_legs l
      SET result = CASE
        WHEN sel.result IN ('push', 'void') THEN sel.result
        WHEN l.side = 'back' THEN sel.result
        WHEN l.side = 'lay'  THEN CASE sel.result WHEN 'won' THEN 'lost' WHEN 'lost' THEN 'won' END
      END
      FROM public.bet_selections sel
      WHERE l.bet_id = v_bet.id AND l.selection_id = sel.id AND sel.result IS NOT NULL;

    -- A leg still unresolved (other market of a parlay) → leave bet pending.
    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result IS NULL) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger.
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void')
    ) THEN
      -- All legs push/void → refund the stake (double-entry).
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, false,  v_bet.stake, 'bet_refund', 'Push refund',         v_bet.id),
        (NULL,            v_bet.season_id, true,  -v_bet.stake, 'bet_refund', 'Push refund (house)', v_bet.id);

    ELSE
      -- Won: payout = floor(stake × product(won-leg odds)). Push/void legs drop out.
      v_odds := 1;
      FOR v_leg IN
        SELECT odds_at_placement FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won'
      LOOP
        v_odds := v_odds * v_leg.odds_at_placement;
      END LOOP;
      v_payout := FLOOR(v_bet.stake * v_odds);

      UPDATE public.bets
        SET status = 'won', potential_payout = v_payout, settled_at = now()
        WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, false,  v_payout, 'bet_payout', 'Bet won',         v_bet.id),
        (NULL,            v_bet.season_id, true,  -v_payout, 'bet_payout', 'Bet won (house)', v_bet.id);
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.games_same_week()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE wa uuid; wb uuid;
BEGIN
  SELECT week_id INTO wa FROM public.teams WHERE id = NEW.team_a_id;
  SELECT week_id INTO wb FROM public.teams WHERE id = NEW.team_b_id;
  IF wa IS DISTINCT FROM wb THEN
    RAISE EXCEPTION 'games.team_a_id and team_b_id must belong to the same week (% vs %)', wa, wb;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_registered_player(phone text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE players.phone = is_registered_player.phone
  );
$function$
;

CREATE OR REPLACE FUNCTION public.link_auth_user_to_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    UPDATE players
    SET user_id = NEW.id
    WHERE phone = '+' || NEW.phone
      AND user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_balance   integer;
  v_odds      numeric := 1;
  v_payout    integer;
  v_bet_id    uuid;
  v_sel       record;
  v_n         integer;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season, and
  -- enforce anti-tanking. Each selection must belong to a distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE v_mseason uuid;
    BEGIN
      SELECT season_id INTO v_mseason FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Capture week_id from the first selection (all O/U legs share the same week).
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.key = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_season_id;
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  INSERT INTO public.bets (player_id, season_id, counterparty, stake, potential_payout, status)
    VALUES (v_player_id, v_season_id, 'house', p_stake, v_payout, 'pending')
    RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, s.id, 'back', s.odds, s.line
    FROM public.bet_selections s
    WHERE s.id = ANY (p_selection_ids);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
    (v_player_id, v_season_id, v_week_id, false, -p_stake, 'bet_stake', 'Bet placed',         v_bet_id),
    (NULL,        v_season_id, v_week_id, true,   p_stake, 'bet_stake', 'Bet placed (house)', v_bet_id);

  -- Activity Feed: post at most ONE placement event by priority (§3, §10.3).
  -- v_balance here is the pre-bet balance; v_n is the leg count; v_payout is the
  -- total potential payout (the "to win" figure surfaced on the feed card).
  IF p_stake >= GREATEST(250, FLOOR(0.10 * v_balance)) THEN
    -- Big ticket.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_big_ticket_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.big_ticket_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_loan_product_term_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF OLD.season_id IS DISTINCT FROM NEW.season_id
     OR OLD.borrow_amount IS DISTINCT FROM NEW.borrow_amount
     OR OLD.weekly_interest_rate IS DISTINCT FROM NEW.weekly_interest_rate
     OR OLD.garnishment_rate IS DISTINCT FROM NEW.garnishment_rate
     OR OLD.max_uses IS DISTINCT FROM NEW.max_uses
     OR OLD.available_from IS DISTINCT FROM NEW.available_from
     OR OLD.available_until IS DISTINCT FROM NEW.available_until THEN
    RAISE EXCEPTION 'loan product functional terms are immutable after creation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_non_open_season_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.registration_open is not true then
    raise exception
      'Season % cannot be deleted: only seasons with open registration may be removed.',
      old.number
      using errcode = 'check_violation';
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_self_tank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_bettor  uuid;
  v_subject uuid;
  v_key     text;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.key
    INTO v_subject, v_key
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_key = 'under')
       OR (NEW.side = 'lay' AND v_key = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_weekly_loans(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_loan        record;
  v_product     public.loan_products;
  v_pincome     integer;
  v_outstanding integer;
  v_garnish     integer;
  v_interest    integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_loan IN
    SELECT id, player_id, season_id, loan_product_id
    FROM public.loans
    WHERE season_id = v_season_id AND status = 'active'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.loan_ledger
      WHERE loan_id = v_loan.id AND week_id = p_week_id
        AND type IN ('weekly_garnishment', 'weekly_interest')
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM public.loan_products WHERE id = v_loan.loan_product_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_pincome
      FROM public.pin_ledger
      WHERE player_id = v_loan.player_id AND week_id = p_week_id AND type = 'score_credit';

    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;

    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    v_garnish := LEAST(CEIL(v_pincome * v_product.garnishment_rate)::int, v_outstanding);
    IF v_garnish > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_loan.player_id, v_loan.season_id, p_week_id, false, -v_garnish, 'loan_weekly_garnishment', 'Loan garnishment')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_loan.season_id, p_week_id, true, v_garnish, 'loan_weekly_garnishment', 'Loan garnishment (house)')
        RETURNING id INTO v_pin_house;

      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, -v_garnish, 'weekly_garnishment', 'Loan garnishment', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;
    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    v_interest := CEIL(v_outstanding * v_product.weekly_interest_rate)::int;
    IF v_interest > 0 THEN
      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, v_interest, 'weekly_interest', 'Weekly interest', NULL);
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_activity_event(p_source_feature text, p_event_type text, p_season_id uuid, p_week_id uuid, p_actor_player_id uuid, p_subject_player_id uuid, p_secondary_player_id uuid, p_sportsbook_bet_id uuid, p_loan_id uuid, p_template_key text, p_public_payload jsonb, p_admin_payload jsonb, p_visibility text, p_occurred_at timestamp with time zone, p_pvp_challenge_id uuid DEFAULT NULL::uuid, p_bounty_post_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_def_visibility text;
  v_requires_actor boolean;
  v_allowed_fk     text;   -- 'sportsbook_bet_id' | 'loan_id' | 'pvp_challenge_id' | 'bounty_post_id' | 'none'
  v_template       text;
  v_visibility     text;
  v_id             uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Event catalog lookup. RAISE on unknown event_type. (Importance is no longer
  --    set here — it is derived in the app from event_type.)
  CASE p_event_type
    WHEN 'sportsbook_bet_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.bet_placed';
    WHEN 'sportsbook_parlay_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_placed';
    WHEN 'sportsbook_big_ticket_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_ticket_placed';
    WHEN 'sportsbook_big_win' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_win';
    WHEN 'sportsbook_parlay_hit' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_hit';
    WHEN 'sportsbook_weekly_house_result' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'sportsbook.weekly_house_result';
    WHEN 'loan_shark_loan_taken' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_taken';
    WHEN 'loan_shark_loan_repaid' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_repaid';
    WHEN 'loan_shark_special_offer' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'loan_shark.special_offer';
    WHEN 'pvp_challenge_accepted' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_accepted';
    WHEN 'pvp_challenge_settled' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_settled';
    WHEN 'bounty_board_bounty_posted' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_posted';
    WHEN 'bounty_board_hunter_joined' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.hunter_joined';
    WHEN 'bounty_board_bounty_closed' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_closed';
    WHEN 'bounty_board_sponsor_won' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.sponsor_won';
    WHEN 'bounty_board_hunters_won' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.hunters_won';
    ELSE
      RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END CASE;

  -- 3. Source-FK ↔ feature consistency. The catalog's allowed_source_fk must match
  --    exactly which FK arg is non-NULL (all others must be NULL).
  IF v_allowed_fk = 'sportsbook_bet_id' THEN
    IF p_sportsbook_bet_id IS NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires sportsbook_bet_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'loan_id' THEN
    IF p_loan_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires loan_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'pvp_challenge_id' THEN
    IF p_pvp_challenge_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires pvp_challenge_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'bounty_post_id' THEN
    IF p_bounty_post_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires bounty_post_id only', p_event_type;
    END IF;
  ELSE  -- 'none' → no source FK permitted
    IF p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % must not carry a source FK', p_event_type;
    END IF;
  END IF;

  -- 4. Actor requirement.
  IF v_requires_actor AND p_actor_player_id IS NULL THEN
    RAISE EXCEPTION 'Event % requires an actor_player_id', p_event_type;
  END IF;

  -- 5. template_key must match the catalog (keeps copy controlled).
  IF p_template_key IS DISTINCT FROM v_template THEN
    RAISE EXCEPTION 'template_key % does not match catalog template % for event %',
      p_template_key, v_template, p_event_type;
  END IF;

  -- 6. Apply catalog default visibility.
  v_visibility := COALESCE(p_visibility, v_def_visibility);

  -- 7. Insert (idempotent via the partial unique dedup indexes).
  INSERT INTO public.activity_feed_events (
    season_id, week_id, source_feature, event_type,
    actor_player_id, subject_player_id, secondary_player_id,
    sportsbook_bet_id, loan_id, pvp_challenge_id, bounty_post_id,
    visibility, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id, p_pvp_challenge_id, p_bounty_post_id,
    v_visibility, 'published',
    v_template, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pvp_player_line(p_player_id uuid, p_season_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_avg        numeric;
  v_league_avg numeric;
BEGIN
  -- Player's mean of current-season archived scores.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id
    AND w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score IS NOT NULL;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- Fallback: league average (mean of all players' per-player season averages).
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = p_season_id
      AND w.is_archived = true
      AND ts.player_id IS NOT NULL
      AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  RETURN floor(v_league_avg) + 0.5;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_bets_before_market_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Refund: delete both ledger rows (player − and house +) of every bet that has
  -- a leg on a selection of the market about to be deleted. Removing the pair by
  -- bet_id restores the balance to before the bet was placed.
  DELETE FROM public.pin_ledger
   WHERE bet_id IN (
     SELECT l.bet_id
       FROM public.bet_legs l
       JOIN public.bet_selections s ON s.id = l.selection_id
      WHERE s.market_id = OLD.id
   );

  -- Delete those bets (cascades to their bet_legs across every game of a parlay,
  -- so a parlay touching this market refunds whole).
  DELETE FROM public.bets
   WHERE id IN (
     SELECT l.bet_id
       FROM public.bet_legs l
       JOIN public.bet_selections s ON s.id = l.selection_id
      WHERE s.market_id = OLD.id
   );

  RETURN OLD;  -- let the market delete proceed; it cascades to its bet_selections
END;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_over_under_markets_for_game(p_week_id uuid, p_game_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Refund (delete both ledger rows of) every bet with a leg on this game's markets.
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Delete those bets (cascades to their bet_legs across all of the parlay's games).
  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Drop the markets themselves (cascades to bet_selections).
  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.game_number = p_game_number;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.repay_loan(p_loan_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id   uuid;
  v_loan        public.loans;
  v_week_id     uuid;
  v_outstanding integer;
  v_balance     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
  v_risk_level  text;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;
  IF v_loan.id IS NULL THEN
    RAISE EXCEPTION 'Loan not found';
  END IF;
  IF v_loan.player_id <> v_player_id THEN
    RAISE EXCEPTION 'Not your loan';
  END IF;
  IF v_loan.status <> 'active' THEN
    RAISE EXCEPTION 'Loan is not active';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Repayment amount must be a positive integer';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
    FROM public.loan_ledger WHERE loan_id = p_loan_id;
  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Repayment exceeds outstanding debt';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_loan.season_id;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Repayment exceeds your balance';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_loan.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_loan.season_id, v_week_id, false, -p_amount, 'loan_manual_repayment', 'Loan repayment')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_loan.season_id, v_week_id, true, p_amount, 'loan_manual_repayment', 'Loan repayment (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_loan_id, v_player_id, v_loan.season_id, v_week_id, -p_amount, 'manual_repayment', 'Loan repayment', v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  IF v_outstanding - p_amount = 0 THEN
    UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = p_loan_id;

    -- Activity Feed: full payoff only (§11.1). Partial repayments post nothing.
    -- Vague — public_payload carries ONLY the risk tier (no amounts, §5.5) so the
    -- copy can vary by how dangerous the deal was. Actor = the borrower.
    SELECT risk_level INTO v_risk_level
      FROM public.loan_products WHERE id = v_loan.loan_product_id;

    PERFORM public.publish_activity_event(
      'loan_shark', 'loan_shark_loan_repaid',
      v_loan.season_id, v_week_id, v_player_id, NULL, NULL,
      NULL, p_loan_id,
      'loan_shark.loan_repaid',
      jsonb_build_object('risk_level', v_risk_level),
      jsonb_build_object('loan_id', p_loan_id),
      NULL, now());
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_activity_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.activity_feed_events
    SET status = 'published',
        suppressed_by_admin_id = NULL,
        suppressed_at = NULL,
        suppression_reason = NULL
    WHERE id = p_event_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.scores_slot_in_game()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE slot_team uuid; ga uuid; gb uuid;
BEGIN
  SELECT team_id INTO slot_team FROM public.team_slots WHERE id = NEW.team_slot_id;
  SELECT team_a_id, team_b_id INTO ga, gb FROM public.games WHERE id = NEW.game_id;
  IF slot_team IS DISTINCT FROM ga AND slot_team IS DISTINCT FROM gb THEN
    RAISE EXCEPTION 'scores.game_id (%) matchup (% vs %) does not include the slot''s team (%)',
      NEW.game_id, ga, gb, slot_team;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week. Stamp week_id so the entry
  -- groups under the correct week in the per-player ledger.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE season_id = v_season_id AND type = 'score_credit'
      AND description LIKE 'Week ' || v_week_number || ' %'
  ) THEN
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    SELECT ts.player_id, v_season_id, p_week_id, s.score, 'score_credit',
           'Week ' || v_week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id IS NOT NULL
      AND ts.is_fill = false
      AND s.score IS NOT NULL;
  END IF;

  -- Settle every open/closed (non-settled) over_under market in the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    SELECT s.score INTO v_score
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id = v_mkt.subject_player_id
      AND ts.is_fill = false
      AND g.game_number = v_mkt.game_number
      AND s.score IS NOT NULL
    LIMIT 1;

    IF v_score IS NULL THEN
      -- No score -> close without a result (bets stay pending for manual handling).
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- Settle every non-settled moneyline market whose game has scores.
  FOR v_mkt IN
    SELECT id, subject_game_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'moneyline' AND status <> 'settled'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.scores
      WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
    ) THEN
      PERFORM public.settle_moneyline_market_internal(v_mkt.id);
    ELSE
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    END IF;
  END LOOP;

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  SELECT COALESCE(SUM(amount), 0) INTO v_house_net
    FROM public.pin_ledger
    WHERE is_house = true AND week_id = p_week_id
      AND type IN ('bet_stake','bet_payout','bet_refund');

  -- Idempotency: no source FK exists, so guard on (season, week, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_bounty(p_bounty_post_id uuid, p_outcome text, p_admin_settlement_reasoning text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty          public.bounty_post;
  v_admin_id        uuid;
  v_hunter_count    int;
  v_R               int;   -- reward per hunter
  v_escrow          int;   -- sponsor escrow held = R * max_hunters
  v_total_stakes    int;   -- SUM(stake_amount) = n * H
  v_total_reward    int;   -- SUM(protected_hunter_profit) = n * R
  v_unused_escrow   int;   -- (max_hunters - n) * R returned to sponsor
  v_total_house_seed int;
  v_total_pot       int;
  v_settlement_id   uuid;
  v_payout_id       uuid;
  v_stake           record;
  v_payout          int;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  IF v_bounty.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  -- Settle at any time: an 'open' or 'closed' bounty may be settled directly.
  IF v_bounty.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Bounty cannot be settled in its current state';
  END IF;

  IF p_outcome NOT IN ('sponsor_win', 'hunter_win') THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;
  IF length(coalesce(p_admin_settlement_reasoning, '')) = 0 THEN
    RAISE EXCEPTION 'Settlement reasoning is required';
  END IF;

  SELECT count(*) INTO v_hunter_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_hunter_count < 1 THEN
    RAISE EXCEPTION 'Bounty has no hunters — cancel it instead of settling';
  END IF;

  v_R      := v_bounty.reward_per_hunter;
  v_escrow := v_bounty.sponsor_bounty_amount;  -- R * max_hunters
  SELECT COALESCE(SUM(stake_amount), 0), COALESCE(SUM(protected_hunter_profit), 0)
    INTO v_total_stakes, v_total_reward
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_unused_escrow := GREATEST(0, v_escrow - (v_hunter_count * v_R));

  -- House seed = the House subsidy when a House bounty loses to the hunters
  -- (it funds n*R out of pocket). Zero for sponsor bounties (sponsor-funded).
  v_total_house_seed := CASE
    WHEN v_bounty.bounty_type = 'house_bounty' AND p_outcome = 'hunter_win' THEN v_total_reward
    ELSE 0 END;

  -- total_pot = the headline winnings transferred to the winning side.
  v_total_pot := CASE
    WHEN p_outcome = 'hunter_win' THEN v_total_stakes + v_total_reward  -- n*(H+R)
    ELSE v_total_stakes END;                                            -- sponsor_win: n*H

  INSERT INTO public.bounty_settlements (
    bounty_post_id, settlement_outcome, settlement_source,
    total_sponsor_bounty, total_hunter_stakes, total_protected_hunter_profit,
    total_house_seed, total_pot, winner_count,
    settled_by_admin_id, admin_settlement_reasoning
  ) VALUES (
    p_bounty_post_id, p_outcome, 'admin',
    v_escrow, v_total_stakes, v_total_reward,
    v_total_house_seed, v_total_pot,
    CASE WHEN p_outcome = 'sponsor_win' THEN 1 ELSE v_hunter_count END,
    v_admin_id, p_admin_settlement_reasoning
  )
  RETURNING id INTO v_settlement_id;

  IF p_outcome = 'sponsor_win' THEN
    IF v_bounty.bounty_type = 'sponsor_bounty' THEN
      -- Sponsor collects every hunter stake and gets the full escrow back.
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_bounty.sponsor_player_id, false, v_total_stakes + v_escrow)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_total_stakes + v_escrow,
                'bounty_payout', 'Bounty sponsor won', p_bounty_post_id, v_settlement_id, v_payout_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -(v_total_stakes + v_escrow),
                'bounty_payout', 'Bounty sponsor won (house)', p_bounty_post_id, v_settlement_id, v_payout_id);
    ELSE
      -- House bounty: the House keeps the hunter stakes (reporting-only payout row,
      -- no ledger movement — House-to-House is not ledgered, §22.3).
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, NULL, true, v_total_stakes);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'lost', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;

  ELSE  -- hunter_win
    FOR v_stake IN
      SELECT * FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id
    LOOP
      v_payout := v_stake.stake_amount + v_stake.protected_hunter_profit;  -- H + R (flat)

      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_stake.player_id, false, v_payout)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (v_stake.player_id, v_bounty.season_id, v_bounty.week_id, false, v_payout,
                'bounty_payout', 'Bounty hunter won', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_payout,
                'bounty_payout', 'Bounty hunter won (house)', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
    END LOOP;

    -- Return the sponsor's unused escrow ((max_hunters - n) * R) for a sponsor bounty.
    IF v_bounty.bounty_type = 'sponsor_bounty' AND v_unused_escrow > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned', p_bounty_post_id, v_settlement_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned (house)', p_bounty_post_id, v_settlement_id);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'won', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  END IF;

  UPDATE public.bounty_post SET status = 'settled' WHERE id = p_bounty_post_id;

  IF p_outcome = 'sponsor_win' THEN
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_sponsor_won',
      v_bounty.season_id, v_bounty.week_id,
      CASE WHEN v_bounty.bounty_type = 'sponsor_bounty' THEN v_bounty.sponsor_player_id ELSE NULL END,
      NULL, NULL,
      NULL, NULL,
      'bounty_board.sponsor_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  ELSE
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_hunters_won',
      v_bounty.season_id, v_bounty.week_id,
      NULL, NULL, NULL,
      NULL, NULL,
      'bounty_board.hunters_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_loans_for_season_close(p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_loan        record;
  v_week_id     uuid;
  v_outstanding integer;
  v_balance     integer;
  v_payment     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = p_season_id
    ORDER BY week_number DESC LIMIT 1;

  FOR v_loan IN
    SELECT id, player_id, season_id
    FROM public.loans
    WHERE season_id = p_season_id AND status = 'active'
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger
      WHERE player_id = v_loan.player_id AND season_id = v_loan.season_id;

    v_payment := LEAST(v_balance, v_outstanding);
    IF v_payment > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_loan.player_id, v_loan.season_id, v_week_id, false, -v_payment, 'loan_season_close_settlement', 'Season-close loan settlement')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_loan.season_id, v_week_id, true, v_payment, 'loan_season_close_settlement', 'Season-close loan settlement (house)')
        RETURNING id INTO v_pin_house;

      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, v_week_id, -v_payment, 'season_close_settlement', 'Season-close loan settlement', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    UPDATE public.loans SET status = 'season_closed', season_closed_at = now() WHERE id = v_loan.id;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_market(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  PERFORM public.settle_market_internal(p_market_id, p_result_value);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_market_internal(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market public.bet_markets;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type <> 'over_under' THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results: over wins above the line, under below; half-point lines
  -- never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.key = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.key = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
                                     WHEN p_result_value > s.line THEN 'lost' ELSE 'push' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  UPDATE public.bet_markets
    SET result_value = p_result_value, status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_moneyline_market(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  PERFORM public.settle_moneyline_market_internal(p_market_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_moneyline_market_internal(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market  public.bet_markets;
  v_team_a  uuid;
  v_team_b  uuid;
  v_total_a integer;
  v_total_b integer;
  v_n       integer;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type <> 'moneyline' THEN
    RAISE EXCEPTION 'settle_moneyline_market_internal only handles moneyline markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  IF v_market.subject_game_id IS NULL THEN
    RAISE EXCEPTION 'Moneyline market has no subject game';
  END IF;

  SELECT team_a_id, team_b_id INTO v_team_a, v_team_b
    FROM public.games WHERE id = v_market.subject_game_id;

  SELECT COUNT(*) INTO v_n
    FROM public.scores WHERE game_id = v_market.subject_game_id AND score IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No scores recorded for this game';
  END IF;

  -- Combined team pinfall for the matchup's game (all bowlers, incl. fills).
  SELECT COALESCE(SUM(sc.score), 0) INTO v_total_a
    FROM public.scores sc
    JOIN public.team_slots ts ON ts.id = sc.team_slot_id
    WHERE sc.game_id = v_market.subject_game_id AND ts.team_id = v_team_a AND sc.score IS NOT NULL;
  SELECT COALESCE(SUM(sc.score), 0) INTO v_total_b
    FROM public.scores sc
    JOIN public.team_slots ts ON ts.id = sc.team_slot_id
    WHERE sc.game_id = v_market.subject_game_id AND ts.team_id = v_team_b AND sc.score IS NOT NULL;

  UPDATE public.bet_selections s
    SET result = CASE
      WHEN v_total_a = v_total_b THEN 'push'
      WHEN s.key = v_team_a::text THEN CASE WHEN v_total_a > v_total_b THEN 'won' ELSE 'lost' END
      WHEN s.key = v_team_b::text THEN CASE WHEN v_total_b > v_total_a THEN 'won' ELSE 'lost' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  -- result_value left null (no numeric outcome for a moneyline).
  UPDATE public.bet_markets
    SET status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_pvp_challenge(p_challenge_id uuid, p_source text, p_winner_player_id uuid, p_admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_challenge      public.pvp_challenges;
  v_creator_score  int;
  v_cparty_score   int;
  v_creator_net    numeric;
  v_cparty_net     numeric;
  v_creator_adj    int;
  v_cparty_adj     int;
  v_winner_id      uuid;
  v_is_push        boolean := false;
  v_is_void        boolean := false;
  v_result_detail  jsonb;
  v_pin_player     uuid;
  v_pin_house      uuid;
  v_pvp_id         uuid;
  v_mkt_result     numeric;
  v_creator_sel    record;
  v_cparty_sel     record;
BEGIN
  IF p_source = 'admin' THEN
    IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
      RAISE EXCEPTION 'Admin only';
    END IF;
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status IN ('settled', 'pushed', 'voided', 'cancelled') THEN
    RETURN;
  END IF;
  IF v_challenge.status <> 'locked' THEN
    RAISE EXCEPTION 'Challenge is not locked — cannot settle';
  END IF;

  IF p_source = 'admin' AND p_winner_player_id IS NOT NULL THEN
    v_winner_id     := p_winner_player_id;
    v_result_detail := jsonb_build_object('source', 'admin', 'winner', p_winner_player_id);
  ELSE
    IF v_challenge.contract_type IN ('line_duel', 'head_to_head') THEN
      SELECT s.score INTO v_creator_score
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = v_challenge.week_id
          AND ts.player_id = v_challenge.creator_player_id
          AND ts.is_fill = false
          AND g.game_number = v_challenge.game_number
          AND s.score IS NOT NULL
        LIMIT 1;

      SELECT s.score INTO v_cparty_score
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = v_challenge.week_id
          AND ts.player_id = v_challenge.counterparty_player_id
          AND ts.is_fill = false
          AND g.game_number = v_challenge.game_number
          AND s.score IS NOT NULL
        LIMIT 1;

      IF v_creator_score IS NULL OR v_cparty_score IS NULL THEN
        v_is_void := true;
      ELSIF v_challenge.contract_type = 'line_duel' THEN
        v_creator_net := v_creator_score - v_challenge.creator_line;
        v_cparty_net  := v_cparty_score  - v_challenge.counterparty_line;
        v_result_detail := jsonb_build_object(
          'creator_score', v_creator_score, 'creator_line', v_challenge.creator_line, 'creator_net', v_creator_net,
          'counterparty_score', v_cparty_score, 'counterparty_line', v_challenge.counterparty_line, 'counterparty_net', v_cparty_net
        );
        IF v_creator_net > v_cparty_net THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_net > v_creator_net THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      ELSE
        v_creator_adj := v_creator_score + COALESCE(v_challenge.creator_handicap, 0);
        v_cparty_adj  := v_cparty_score  + COALESCE(v_challenge.counterparty_handicap, 0);
        v_result_detail := jsonb_build_object(
          'creator_score', v_creator_score, 'creator_handicap', COALESCE(v_challenge.creator_handicap, 0), 'creator_adjusted', v_creator_adj,
          'counterparty_score', v_cparty_score, 'counterparty_handicap', COALESCE(v_challenge.counterparty_handicap, 0), 'counterparty_adjusted', v_cparty_adj
        );
        IF v_creator_adj > v_cparty_adj THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_adj > v_creator_adj THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      END IF;

    ELSIF v_challenge.contract_type = 'prop_duel' THEN
      SELECT result_value INTO v_mkt_result
        FROM public.bet_markets WHERE id = v_challenge.prop_market_id;

      IF v_mkt_result IS NULL THEN
        v_is_void := true;
      ELSE
        SELECT s.key, s.line, s.result INTO v_creator_sel
          FROM public.bet_selections s
          WHERE s.market_id = v_challenge.prop_market_id AND s.key = v_challenge.creator_selection
          LIMIT 1;
        SELECT s.key, s.line, s.result INTO v_cparty_sel
          FROM public.bet_selections s
          WHERE s.market_id = v_challenge.prop_market_id AND s.key = v_challenge.counterparty_selection
          LIMIT 1;

        v_result_detail := jsonb_build_object(
          'market_result', v_mkt_result,
          'creator_selection', v_challenge.creator_selection,   'creator_result', v_creator_sel.result,
          'counterparty_selection', v_challenge.counterparty_selection, 'counterparty_result', v_cparty_sel.result
        );

        IF v_creator_sel.result = 'won' THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_sel.result = 'won' THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      END IF;

    ELSIF v_challenge.contract_type = 'custom' THEN
      RAISE EXCEPTION 'Custom contracts must be settled with an explicit winner, or voided';
    END IF;
  END IF;

  -- Void path: refund stakes (no feed event — no contest happened).
  IF v_is_void THEN
    PERFORM public.void_pvp_challenge(p_challenge_id, COALESCE(p_admin_note, 'Score unavailable — voided at settlement'));
    RETURN;
  END IF;

  -- Push path: refund stakes.
  IF v_is_push THEN
    DECLARE v_stake_row record;
    BEGIN
      FOR v_stake_row IN
        SELECT * FROM public.pvp_ledger
        WHERE challenge_id = p_challenge_id AND type = 'stake' AND player_id IS NOT NULL
      LOOP
        INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
          VALUES (v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
                  false, -v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded')
          RETURNING id INTO v_pin_player;
        INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
          VALUES (NULL, v_stake_row.season_id, v_stake_row.week_id,
                  true, v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded (house)')
          RETURNING id INTO v_pin_house;

        INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
          VALUES (p_challenge_id, v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
                  -v_stake_row.amount, 'refund', 'Push refund', v_pin_player)
          RETURNING id INTO v_pvp_id;

        UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
      END LOOP;
    END;

    UPDATE public.pvp_challenges SET
      status        = 'pushed',
      result_detail = COALESCE(v_result_detail, '{}'::jsonb),
      settled_at    = now(),
      admin_note    = p_admin_note
    WHERE id = p_challenge_id;

    -- Activity Feed: a draw — both parties named, no winner badge.
    PERFORM public.publish_activity_event(
      'pvp', 'pvp_challenge_settled',
      v_challenge.season_id, v_challenge.week_id,
      v_challenge.creator_player_id, NULL, v_challenge.counterparty_player_id,
      NULL, NULL,
      'pvp.challenge_settled',
      jsonb_build_object('outcome', 'push', 'pot', v_challenge.total_pot,
                         'contract_type', v_challenge.contract_type),
      jsonb_build_object('challenge_id', p_challenge_id, 'source', p_source),
      NULL, now(),
      p_challenge_id);
    RETURN;
  END IF;

  -- Winner path: pay the full pot to the winner (player +pot, house -pot).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_winner_id, v_challenge.season_id, v_challenge.week_id,
            false, v_challenge.total_pot, 'pvp_payout', 'PvP challenge won')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, -v_challenge.total_pot, 'pvp_payout', 'PvP challenge won (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_winner_id, v_challenge.season_id, v_challenge.week_id,
            v_challenge.total_pot, 'payout', 'Winner payout (full pot)', v_pin_player)
    RETURNING id INTO v_pvp_id;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);

  UPDATE public.pvp_challenges SET
    status           = 'settled',
    winner_player_id = v_winner_id,
    result_detail    = COALESCE(v_result_detail, '{}'::jsonb),
    settled_at       = now(),
    admin_note       = p_admin_note
  WHERE id = p_challenge_id;

  -- Activity Feed: the WINNER leads the card (actor = winner). Secondary = loser.
  PERFORM public.publish_activity_event(
    'pvp', 'pvp_challenge_settled',
    v_challenge.season_id, v_challenge.week_id,
    v_winner_id, NULL,
    CASE WHEN v_winner_id = v_challenge.creator_player_id
         THEN v_challenge.counterparty_player_id
         ELSE v_challenge.creator_player_id END,
    NULL, NULL,
    'pvp.challenge_settled',
    jsonb_build_object('outcome', 'win', 'pot', v_challenge.total_pot,
                       'contract_type', v_challenge.contract_type),
    jsonb_build_object('challenge_id', p_challenge_id, 'source', p_source),
    NULL, now(),
    p_challenge_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_pvp_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contract record;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Close any still-open negotiations for the whole week (the clock-based expiry
  -- sweep is gone; nothing else closes stale pending/countered contracts now).
  PERFORM public.close_open_pvp_challenges(p_week_id, NULL);

  -- Auto-settle every locked auto-settleable contract for this week.
  FOR v_contract IN
    SELECT id FROM public.pvp_challenges
    WHERE week_id = p_week_id
      AND status = 'locked'
      AND contract_type IN ('line_duel', 'prop_duel', 'head_to_head')
  LOOP
    PERFORM public.settle_pvp_challenge(v_contract.id, 'automatic', NULL, NULL);
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.suppress_activity_event(p_event_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();

  UPDATE public.activity_feed_events
    SET status = 'suppressed',
        suppressed_by_admin_id = v_admin_id,
        suppressed_at = now(),
        suppression_reason = p_reason
    WHERE id = p_event_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_moneyline_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_market_id uuid;
  v_rec       record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_rec IN
    SELECT g.id AS game_id, g.game_number,
           g.team_a_id, g.team_b_id,
           ta.team_number AS team_a_number,
           tb.team_number AS team_b_number
    FROM public.games g
    JOIN public.teams ta ON ta.id = g.team_a_id
    JOIN public.teams tb ON tb.id = g.team_b_id
    WHERE ta.week_id = p_week_id
      AND g.team_a_id IS NOT NULL AND g.team_b_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_markets m
        WHERE m.market_type = 'moneyline' AND m.subject_game_id = g.id
      )
  LOOP
    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_game_id, status)
      VALUES ('moneyline',
              'Team ' || v_rec.team_a_number || ' vs Team ' || v_rec.team_b_number,
              p_week_id, v_rec.game_number, v_rec.game_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, v_rec.team_a_id::text, 'Team ' || v_rec.team_a_number, 2.000, NULL, 0),
      (v_market_id, v_rec.team_b_id::text, 'Team ' || v_rec.team_b_number, 2.000, NULL, 1);
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid, p_extra_games integer[] DEFAULT '{}'::integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_target_games integer[];
  v_league_avg   numeric;
  v_avg          numeric;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Target games = distinct game_number of existing O/U markets ∪ p_extra_games,
  -- defaulting to {1,2} when there are neither.
  SELECT ARRAY(
    SELECT DISTINCT g FROM (
      SELECT game_number AS g FROM public.bet_markets
        WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
      UNION
      SELECT UNNEST(COALESCE(p_extra_games, '{}'))
    ) u
  ) INTO v_target_games;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;

  -- --- Refund + remove markets for players no longer "in" --------------------
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.subject_player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  -- --- League average (mean of per-player current-season archived averages) ---
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  -- --- Create missing markets for "in" players --------------------------------
  FOR v_rec IN
    SELECT ip.player_id, g.game_number, p.name
    FROM (SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in') ip
    CROSS JOIN UNNEST(v_target_games) AS g(game_number)
    JOIN public.players p ON p.id = ip.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = g.game_number AND m.subject_player_id = ip.player_id
    )
  LOOP
    SELECT AVG(s.score) INTO v_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id = v_rec.player_id AND s.score IS NOT NULL;

    v_line := FLOOR(COALESCE(v_avg, v_league_avg)) + 0.5;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.take_loan(p_loan_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_product   public.loan_products;
  v_used      integer;
  v_loan_id   uuid;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_debt_id    uuid;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  SELECT * INTO v_product FROM public.loan_products WHERE id = p_loan_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Loan product not found';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'Loan product is not available';
  END IF;
  IF v_product.season_id IS NOT NULL AND v_product.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Loan product is not available this season';
  END IF;
  IF v_product.available_from IS NOT NULL AND now() < v_product.available_from THEN
    RAISE EXCEPTION 'Loan product is not yet available';
  END IF;
  IF v_product.available_until IS NOT NULL AND now() > v_product.available_until THEN
    RAISE EXCEPTION 'Loan product is no longer available';
  END IF;
  IF v_product.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.loans WHERE loan_product_id = p_loan_product_id;
    IF v_used >= v_product.max_uses THEN
      RAISE EXCEPTION 'Loan product has reached its usage limit';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE player_id = v_player_id AND season_id = v_season_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You already have an active loan this season';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.loans (player_id, season_id, loan_product_id, status)
    VALUES (v_player_id, v_season_id, p_loan_product_id, 'active')
    RETURNING id INTO v_loan_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_season_id, v_week_id, false, v_product.borrow_amount, 'loan_issued', 'Loan issued: ' || v_product.display_name)
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_season_id, v_week_id, true, -v_product.borrow_amount, 'loan_issued', 'Loan issued (house): ' || v_product.display_name)
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (v_loan_id, v_player_id, v_season_id, v_week_id, v_product.borrow_amount, 'loan_issued',
            'Loan issued: ' || v_product.display_name, v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  -- Activity Feed: vague loan-taken event. public_payload carries ONLY the risk
  -- tier (no amount/rate/product, §11.1, §5.5) so the copy can hint at the kind
  -- of deal. Operational detail lives in admin_payload.
  PERFORM public.publish_activity_event(
    'loan_shark', 'loan_shark_loan_taken',
    v_season_id, v_week_id, v_player_id, NULL, NULL,
    NULL, v_loan_id,
    'loan_shark.loan_taken',
    jsonb_build_object('risk_level', v_product.risk_level),
    jsonb_build_object('loan_id', v_loan_id, 'loan_product_id', p_loan_product_id),
    NULL, now());

  RETURN v_loan_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.void_pvp_challenge(p_challenge_id uuid, p_admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_challenge  public.pvp_challenges;
  v_row        record;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_pvp_id     uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('locked', 'settled') THEN
    RAISE EXCEPTION 'Can only void a locked or settled challenge';
  END IF;

  -- If already settled, reverse the payout movement first (player + house pair).
  IF v_challenge.status = 'settled' THEN
    FOR v_row IN
      SELECT * FROM public.pvp_ledger
      WHERE challenge_id = p_challenge_id
        AND type = 'payout'
        AND player_id IS NOT NULL
    LOOP
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_row.player_id, v_row.season_id, v_row.week_id,
                false, -v_row.amount, 'pvp_refund', 'PvP void — settlement reversed')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_row.season_id, v_row.week_id,
                true, v_row.amount, 'pvp_refund', 'PvP void — settlement reversed (house)')
        RETURNING id INTO v_pin_house;

      INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (p_challenge_id, v_row.player_id, v_row.season_id, v_row.week_id,
                -v_row.amount, 'refund', 'Settlement reversal', v_pin_player)
        RETURNING id INTO v_pvp_id;

      UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
    END LOOP;
  END IF;

  -- Refund each player's stake (player +stake, house -stake).
  FOR v_row IN
    SELECT * FROM public.pvp_ledger
    WHERE challenge_id = p_challenge_id AND type = 'stake' AND player_id IS NOT NULL
  LOOP
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
      VALUES (v_row.player_id, v_row.season_id, v_row.week_id,
              false, -v_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded')
      RETURNING id INTO v_pin_player;
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
      VALUES (NULL, v_row.season_id, v_row.week_id,
              true, v_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded (house)')
      RETURNING id INTO v_pin_house;

    INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
      VALUES (p_challenge_id, v_row.player_id, v_row.season_id, v_row.week_id,
              -v_row.amount, 'refund', 'Void refund', v_pin_player)
      RETURNING id INTO v_pvp_id;

    UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
  END LOOP;

  UPDATE public.pvp_challenges SET
    status     = 'voided',
    admin_note = p_admin_note,
    settled_at = now()
  WHERE id = p_challenge_id;
END;
$function$
;


-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.activity_feed_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER bet_legs_no_self_tank BEFORE INSERT OR UPDATE ON public.bet_legs FOR EACH ROW EXECUTE FUNCTION prevent_self_tank();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_legs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_markets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_refund_bets_before_market_delete BEFORE DELETE ON public.bet_markets FOR EACH ROW EXECUTE FUNCTION refund_bets_before_market_delete();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_selections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.board_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_hunter_stakes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_post FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER games_same_week_check BEFORE INSERT OR UPDATE OF team_a_id, team_b_id ON public.games FOR EACH ROW EXECUTE FUNCTION games_same_week();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loan_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER loan_products_immutable_terms BEFORE UPDATE ON public.loan_products FOR EACH ROW EXECUTE FUNCTION prevent_loan_product_term_updates();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loan_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pin_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_challenge_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_challenges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rsvp FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER scores_slot_in_game_check BEFORE INSERT OR UPDATE OF team_slot_id, game_id ON public.scores FOR EACH ROW EXECUTE FUNCTION scores_slot_in_game();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.season_champions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER prevent_non_open_season_delete BEFORE DELETE ON public.seasons FOR EACH ROW EXECUTE FUNCTION prevent_non_open_season_delete();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.team_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.weeks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
