-- Current-state schema snapshot of the public schema.
-- GENERATED — do not edit by hand. Regenerate after every `supabase db push`.
-- Source of truth for CURRENT schema; migration files are append-only history.

-- =====================================================
-- TABLES
-- =====================================================

CREATE TABLE activity_event_catalog (
  event_type text NOT NULL,
  source_feature text NOT NULL,
  template_key text NOT NULL,
  requires_actor boolean NOT NULL,
  allowed_fk text NOT NULL,
  default_visibility text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

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
  bounty_post_id uuid,
  auction_id uuid
);

CREATE TABLE app_version_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  min_supported_version text NOT NULL DEFAULT '1.0.23'::text,
  message text NOT NULL DEFAULT 'A new version of the app is required. Update on TestFlight to keep playing.'::text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE auction_bids (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL,
  player_id uuid NOT NULL,
  bid_amount_enc bytea NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE auction_house_state (
  season_id uuid NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  closed_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE auctions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  catalog_item_id uuid NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'scheduled'::text,
  opens_at timestamp with time zone NOT NULL,
  closes_at timestamp with time zone NOT NULL,
  minimum_bid integer NOT NULL,
  bounce_fee integer NOT NULL DEFAULT 50,
  bidder_count integer NOT NULL DEFAULT 0,
  winner_player_id uuid,
  winning_bid_id uuid,
  winning_price integer,
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE bet_haunts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bet_id uuid NOT NULL,
  haunter_player_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  season_id uuid NOT NULL,
  week_id uuid,
  attached_at timestamp with time zone NOT NULL DEFAULT now(),
  payout_amount integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
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
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  side text
);

CREATE TABLE bets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  season_id uuid NOT NULL,
  stake integer NOT NULL,
  potential_payout integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  custom_line_id uuid,
  custom_line_title text,
  custom_line_description text,
  custom_line_category text,
  week_id uuid,
  insurance_item_id uuid,
  crutch_item_id uuid,
  boost_item_id uuid,
  boost_pct numeric
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

CREATE TABLE broadcast_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE broadcast_event_rules (
  event_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  category_id uuid NOT NULL,
  title_template text NOT NULL,
  body_template text NOT NULL,
  route_key text DEFAULT 'market_moves'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE broadcast_push_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL,
  push_token_id uuid,
  ticket_id text,
  status text NOT NULL DEFAULT 'pending_receipt'::text,
  error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_player_ids uuid[],
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'admin'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  scheduled_for timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  claimed_at timestamp with time zone,
  sent_at timestamp with time zone,
  recipient_count integer,
  delivered_count integer,
  failed_count integer,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE custom_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  category text NOT NULL DEFAULT 'default'::text,
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  week_ids uuid[],
  is_active boolean NOT NULL DEFAULT true,
  created_by_player_id uuid,
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

CREATE TABLE item_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  effect_type text NOT NULL,
  effect_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  activation_mode text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE lanetalk_game_imports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_url text NOT NULL,
  game_number integer NOT NULL,
  classification text NOT NULL,
  player_id uuid,
  team_slot_id uuid,
  week_id uuid,
  score integer,
  played_at timestamp with time zone,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  frames integer,
  strikes integer,
  spares integer,
  clean_pct numeric,
  first_ball_avg numeric
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

CREATE TABLE odds_engine_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid,
  is_enabled boolean NOT NULL DEFAULT true,
  half_life_games numeric NOT NULL DEFAULT 6,
  prior_weight_games numeric NOT NULL DEFAULT 6,
  variance_floor_score numeric NOT NULL DEFAULT 225,
  variance_floor_count numeric NOT NULL DEFAULT 0.75,
  odds_min numeric NOT NULL DEFAULT 1.20,
  odds_max numeric NOT NULL DEFAULT 8.00,
  rungs_per_side integer NOT NULL DEFAULT 3,
  spacing_score numeric NOT NULL DEFAULT 10,
  spacing_night_pins numeric NOT NULL DEFAULT 20,
  spacing_count numeric NOT NULL DEFAULT 1.0,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  custom_odds_min numeric,
  custom_odds_max numeric,
  quote_tolerance numeric NOT NULL DEFAULT 0.10
);

CREATE TABLE odds_engine_stat_corr (
  stat_a text NOT NULL,
  stat_b text NOT NULL,
  rho numeric NOT NULL,
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
  auction_id uuid
);

CREATE TABLE player_inventory_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  catalog_item_id uuid NOT NULL,
  season_id uuid NOT NULL,
  source text NOT NULL,
  auction_id uuid,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE players (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  user_id uuid,
  role text NOT NULL DEFAULT 'player'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  avatar_path text,
  jersey_purchased boolean NOT NULL DEFAULT false,
  name text DEFAULT 
CASE
    WHEN (last_name = ''::text) THEN first_name
    ELSE ((first_name || ' '::text) || last_name)
END
);

CREATE TABLE playoff_draft_captains (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  player_id uuid NOT NULL,
  seed integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE playoff_draft_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  pick_number integer NOT NULL,
  captain_player_id uuid NOT NULL,
  picked_player_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE playoff_draft_pool (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  player_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE playoff_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  week_id uuid NOT NULL,
  draft_type text NOT NULL DEFAULT 'snake'::text,
  status text NOT NULL DEFAULT 'setup'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE push_category_prefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  category_id uuid NOT NULL,
  enabled boolean NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE push_preferences (
  player_id uuid NOT NULL,
  master_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios'::text,
  last_registered_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
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

CREATE TABLE recurring_broadcast_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  audience text NOT NULL,
  day_of_week smallint NOT NULL,
  send_time time without time zone NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York'::text,
  category_id uuid NOT NULL,
  route_key text,
  title text NOT NULL,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  last_fired_at timestamp with time zone NOT NULL DEFAULT now(),
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

CREATE TABLE rsvp_bonus_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id uuid,
  is_enabled boolean NOT NULL DEFAULT true,
  bonus_amount integer NOT NULL DEFAULT 50,
  deadline_time time without time zone NOT NULL DEFAULT '18:00:00'::time without time zone,
  timezone text NOT NULL DEFAULT 'America/New_York'::text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
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

CREATE TABLE week_archive_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL,
  season_id uuid NOT NULL,
  actor_id uuid,
  archived_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active'::text,
  reversed_mode text,
  reversed_at timestamp with time zone,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE week_archive_snapshot (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  kind text NOT NULL,
  table_name text NOT NULL,
  pk uuid NOT NULL,
  payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  phase text NOT NULL DEFAULT 'advance'::text
);

CREATE TABLE weeks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  week_number integer NOT NULL,
  bowled_at date,
  is_confirmed boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  season_id uuid NOT NULL,
  is_playoff boolean NOT NULL DEFAULT false,
  settled_at timestamp with time zone
);


-- =====================================================
-- CONSTRAINTS
-- =====================================================

ALTER TABLE activity_event_catalog ADD CONSTRAINT activity_event_catalog_allowed_fk_check CHECK ((allowed_fk = ANY (ARRAY['sportsbook_bet_id'::text, 'loan_id'::text, 'pvp_challenge_id'::text, 'bounty_post_id'::text, 'auction_id'::text, 'none'::text])));

ALTER TABLE activity_event_catalog ADD CONSTRAINT activity_event_catalog_pkey PRIMARY KEY (event_type);

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_actor_player_id_fkey FOREIGN KEY (actor_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_auction_id_fkey FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_event_type_fkey FOREIGN KEY (event_type) REFERENCES activity_event_catalog(event_type);

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_pkey PRIMARY KEY (id);

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_pvp_challenge_id_fkey FOREIGN KEY (pvp_challenge_id) REFERENCES pvp_challenges(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_secondary_player_id_fkey FOREIGN KEY (secondary_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check CHECK ((source_feature = ANY (ARRAY['sportsbook'::text, 'loan_shark'::text, 'pvp'::text, 'bounty_board'::text, 'auction_house'::text, 'system'::text, 'admin'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_sportsbook_bet_id_fkey FOREIGN KEY (sportsbook_bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_status_check CHECK ((status = ANY (ARRAY['published'::text, 'suppressed'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_subject_player_id_fkey FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_suppressed_by_admin_id_fkey FOREIGN KEY (suppressed_by_admin_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'admin_only'::text])));

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_events_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE activity_feed_events ADD CONSTRAINT activity_feed_one_source_check CHECK ((((((((sportsbook_bet_id IS NOT NULL))::integer + ((loan_id IS NOT NULL))::integer) + ((pvp_challenge_id IS NOT NULL))::integer) + ((bounty_post_id IS NOT NULL))::integer) + ((auction_id IS NOT NULL))::integer) <= 1));

ALTER TABLE app_version_config ADD CONSTRAINT app_version_config_min_supported_version_check CHECK ((min_supported_version ~ '^[0-9]+(\.[0-9]+)*$'::text));

ALTER TABLE app_version_config ADD CONSTRAINT app_version_config_pkey PRIMARY KEY (id);

ALTER TABLE app_version_config ADD CONSTRAINT app_version_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_auction_id_fkey FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE;

ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_pkey PRIMARY KEY (id);

ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_status_check CHECK ((status = ANY (ARRAY['active'::text, 'won'::text])));

ALTER TABLE auction_house_state ADD CONSTRAINT auction_house_state_pkey PRIMARY KEY (season_id);

ALTER TABLE auction_house_state ADD CONSTRAINT auction_house_state_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE auction_house_state ADD CONSTRAINT auction_house_state_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES players(id);

ALTER TABLE auctions ADD CONSTRAINT auctions_bounce_fee_check CHECK ((bounce_fee >= 0));

ALTER TABLE auctions ADD CONSTRAINT auctions_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES item_catalog(id);

ALTER TABLE auctions ADD CONSTRAINT auctions_check CHECK ((closes_at > opens_at));

ALTER TABLE auctions ADD CONSTRAINT auctions_minimum_bid_check CHECK ((minimum_bid > 0));

ALTER TABLE auctions ADD CONSTRAINT auctions_pkey PRIMARY KEY (id);

ALTER TABLE auctions ADD CONSTRAINT auctions_quantity_check CHECK (((quantity >= 1) AND (quantity <= 50)));

ALTER TABLE auctions ADD CONSTRAINT auctions_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE auctions ADD CONSTRAINT auctions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'open'::text, 'settled'::text])));

ALTER TABLE auctions ADD CONSTRAINT auctions_winner_player_id_fkey FOREIGN KEY (winner_player_id) REFERENCES players(id);

ALTER TABLE auctions ADD CONSTRAINT auctions_winning_bid_id_fkey FOREIGN KEY (winning_bid_id) REFERENCES auction_bids(id) ON DELETE SET NULL;

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_bet_id_haunter_player_id_key UNIQUE (bet_id, haunter_player_id);

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_haunter_player_id_fkey FOREIGN KEY (haunter_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES player_inventory_items(id);

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_pkey PRIMARY KEY (id);

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE bet_haunts ADD CONSTRAINT bet_haunts_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE;

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_bet_id_selection_id_key UNIQUE (bet_id, selection_id);

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_odds_at_placement_check CHECK ((odds_at_placement > 1.0));

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_pkey PRIMARY KEY (id);

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text, 'push'::text, 'void'::text, 'crutched'::text])));

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES bet_selections(id) ON DELETE CASCADE;

ALTER TABLE bet_legs ADD CONSTRAINT bet_legs_side_check CHECK ((side = ANY (ARRAY['back'::text, 'lay'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_created_by_player_id_fkey FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_game_number_check CHECK (((game_number IS NULL) OR (game_number >= 1)));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_market_type_check CHECK ((market_type = ANY (ARRAY['over_under'::text, 'moneyline'::text, 'prop'::text, 'team_prop'::text, 'combo'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_pkey PRIMARY KEY (id);

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'settled'::text, 'void'::text])));

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_subject_game_id_fkey FOREIGN KEY (subject_game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_subject_player_id_fkey FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bet_markets ADD CONSTRAINT bet_markets_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_market_id_fkey FOREIGN KEY (market_id) REFERENCES bet_markets(id) ON DELETE CASCADE;

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_market_id_key_key UNIQUE (market_id, key);

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_odds_check CHECK ((odds > 1.0));

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_pkey PRIMARY KEY (id);

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text, 'push'::text, 'void'::text])));

ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_side_check CHECK ((side = ANY (ARRAY['over'::text, 'under'::text])));

ALTER TABLE bets ADD CONSTRAINT bets_boost_item_id_fkey FOREIGN KEY (boost_item_id) REFERENCES player_inventory_items(id);

ALTER TABLE bets ADD CONSTRAINT bets_crutch_item_id_fkey FOREIGN KEY (crutch_item_id) REFERENCES player_inventory_items(id);

ALTER TABLE bets ADD CONSTRAINT bets_custom_line_id_fkey FOREIGN KEY (custom_line_id) REFERENCES custom_lines(id) ON DELETE SET NULL;

ALTER TABLE bets ADD CONSTRAINT bets_insurance_item_id_fkey FOREIGN KEY (insurance_item_id) REFERENCES player_inventory_items(id) ON DELETE SET NULL;

ALTER TABLE bets ADD CONSTRAINT bets_pkey PRIMARY KEY (id);

ALTER TABLE bets ADD CONSTRAINT bets_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE bets ADD CONSTRAINT bets_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE bets ADD CONSTRAINT bets_stake_check CHECK ((stake >= 10));

ALTER TABLE bets ADD CONSTRAINT bets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'won'::text, 'lost'::text, 'push'::text, 'void'::text, 'cancelled'::text])));

ALTER TABLE bets ADD CONSTRAINT bets_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

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

ALTER TABLE broadcast_categories ADD CONSTRAINT broadcast_categories_key_key UNIQUE (key);

ALTER TABLE broadcast_categories ADD CONSTRAINT broadcast_categories_pkey PRIMARY KEY (id);

ALTER TABLE broadcast_event_rules ADD CONSTRAINT broadcast_event_rules_body_template_check CHECK (((char_length(body_template) >= 1) AND (char_length(body_template) <= 1000)));

ALTER TABLE broadcast_event_rules ADD CONSTRAINT broadcast_event_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES broadcast_categories(id);

ALTER TABLE broadcast_event_rules ADD CONSTRAINT broadcast_event_rules_event_type_fkey FOREIGN KEY (event_type) REFERENCES activity_event_catalog(event_type) ON DELETE CASCADE;

ALTER TABLE broadcast_event_rules ADD CONSTRAINT broadcast_event_rules_pkey PRIMARY KEY (event_type);

ALTER TABLE broadcast_event_rules ADD CONSTRAINT broadcast_event_rules_title_template_check CHECK (((char_length(title_template) >= 1) AND (char_length(title_template) <= 120)));

ALTER TABLE broadcast_push_tickets ADD CONSTRAINT broadcast_push_tickets_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE;

ALTER TABLE broadcast_push_tickets ADD CONSTRAINT broadcast_push_tickets_pkey PRIMARY KEY (id);

ALTER TABLE broadcast_push_tickets ADD CONSTRAINT broadcast_push_tickets_push_token_id_fkey FOREIGN KEY (push_token_id) REFERENCES push_tokens(id) ON DELETE SET NULL;

ALTER TABLE broadcast_push_tickets ADD CONSTRAINT broadcast_push_tickets_status_check CHECK ((status = ANY (ARRAY['pending_receipt'::text, 'ok'::text, 'error'::text])));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000)));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_category_id_fkey FOREIGN KEY (category_id) REFERENCES broadcast_categories(id);

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES players(id);

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_created_by_required CHECK (((created_by IS NOT NULL) OR (source = ANY (ARRAY['event'::text, 'recurring'::text]))));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'event'::text, 'recurring'::text])));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'canceled'::text])));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_target_player_ids_check CHECK (((target_player_ids IS NULL) OR (cardinality(target_player_ids) > 0)));

ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));

ALTER TABLE custom_lines ADD CONSTRAINT custom_lines_category_check CHECK ((category = ANY (ARRAY['default'::text, 'special'::text])));

ALTER TABLE custom_lines ADD CONSTRAINT custom_lines_created_by_player_id_fkey FOREIGN KEY (created_by_player_id) REFERENCES players(id);

ALTER TABLE custom_lines ADD CONSTRAINT custom_lines_pkey PRIMARY KEY (id);

ALTER TABLE custom_lines ADD CONSTRAINT custom_lines_title_check CHECK (((length(title) >= 1) AND (length(title) <= 80)));

ALTER TABLE games ADD CONSTRAINT game_schedule_pkey PRIMARY KEY (id);

ALTER TABLE games ADD CONSTRAINT games_distinct_teams_check CHECK ((team_a_id IS DISTINCT FROM team_b_id));

ALTER TABLE games ADD CONSTRAINT games_game_number_team_a_id_key UNIQUE (game_number, team_a_id);

ALTER TABLE games ADD CONSTRAINT games_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE games ADD CONSTRAINT games_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE item_catalog ADD CONSTRAINT item_catalog_activation_mode_check CHECK ((activation_mode = ANY (ARRAY['attach_to_bet'::text, 'attach_to_foreign_bet'::text, 'passive'::text, 'admin_honored'::text])));

ALTER TABLE item_catalog ADD CONSTRAINT item_catalog_effect_type_check CHECK ((effect_type = ANY (ARRAY['bet_insurance'::text, 'parlay_crutch'::text, 'odds_boost'::text, 'haunt'::text, 'cosmetic'::text, 'access_pass'::text, 'custom'::text])));

ALTER TABLE item_catalog ADD CONSTRAINT item_catalog_key_key UNIQUE (key);

ALTER TABLE item_catalog ADD CONSTRAINT item_catalog_pkey PRIMARY KEY (id);

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_classification_check CHECK ((classification = ANY (ARRAY['official'::text, 'recreational'::text])));

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_pkey PRIMARY KEY (id);

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_team_slot_id_fkey FOREIGN KEY (team_slot_id) REFERENCES team_slots(id) ON DELETE SET NULL;

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_url_game_key UNIQUE (source_url, game_number);

ALTER TABLE lanetalk_game_imports ADD CONSTRAINT lanetalk_game_imports_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

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

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_custom_clamp_check CHECK (((custom_odds_min IS NULL) OR (custom_odds_max IS NULL) OR ((custom_odds_min > 1.0) AND (custom_odds_max > custom_odds_min))));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_half_life_check CHECK ((half_life_games > (0)::numeric));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_odds_clamp_check CHECK (((odds_min > 1.0) AND (odds_max > odds_min)));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_pkey PRIMARY KEY (id);

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_prior_weight_check CHECK ((prior_weight_games >= (0)::numeric));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_quote_tolerance_check CHECK ((quote_tolerance >= 0.05));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_rungs_check CHECK (((rungs_per_side >= 0) AND (rungs_per_side <= 6)));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_spacing_check CHECK (((spacing_score > (0)::numeric) AND (spacing_night_pins > (0)::numeric) AND (spacing_count > (0)::numeric)));

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE odds_engine_config ADD CONSTRAINT odds_engine_config_variance_floors_check CHECK (((variance_floor_score > (0)::numeric) AND (variance_floor_count > (0)::numeric)));

ALTER TABLE odds_engine_stat_corr ADD CONSTRAINT odds_engine_stat_corr_check CHECK ((stat_a < stat_b));

ALTER TABLE odds_engine_stat_corr ADD CONSTRAINT odds_engine_stat_corr_pkey PRIMARY KEY (stat_a, stat_b);

ALTER TABLE odds_engine_stat_corr ADD CONSTRAINT odds_engine_stat_corr_rho_check CHECK (((rho > ('-1'::integer)::numeric) AND (rho < (1)::numeric)));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_auction_id_fkey FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_bounty_post_id_fkey FOREIGN KEY (bounty_post_id) REFERENCES bounty_post(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_loan_ledger_id_fkey FOREIGN KEY (loan_ledger_id) REFERENCES loan_ledger(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_owner_chk CHECK ((is_house OR (player_id IS NOT NULL)));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_pkey PRIMARY KEY (id);

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_pvp_ledger_id_fkey FOREIGN KEY (pvp_ledger_id) REFERENCES pvp_ledger(id) ON DELETE SET NULL;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_type_check CHECK ((type = ANY (ARRAY['bonus'::text, 'score_credit'::text, 'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text, 'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text, 'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text, 'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text, 'auction_purchase'::text, 'auction_check_bounce'::text, 'bet_insurance_refund'::text, 'bet_odds_boost'::text, 'bet_haunt_steal'::text, 'rsvp_bonus'::text])));

ALTER TABLE pin_ledger ADD CONSTRAINT pin_ledger_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE SET NULL;

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_auction_id_fkey FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE SET NULL;

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES item_catalog(id);

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_pkey PRIMARY KEY (id);

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE player_inventory_items ADD CONSTRAINT player_inventory_items_source_check CHECK ((source = ANY (ARRAY['auction'::text, 'merchant'::text, 'admin_grant'::text])));

ALTER TABLE players ADD CONSTRAINT players_phone_e164 CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9]\d{6,14}$'::text)));

ALTER TABLE players ADD CONSTRAINT players_phone_key UNIQUE (phone);

ALTER TABLE players ADD CONSTRAINT players_pkey PRIMARY KEY (id);

ALTER TABLE players ADD CONSTRAINT players_role_check CHECK ((role = ANY (ARRAY['player'::text, 'admin'::text])));

ALTER TABLE players ADD CONSTRAINT players_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE players ADD CONSTRAINT players_user_id_key UNIQUE (user_id);

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES playoff_drafts(id) ON DELETE CASCADE;

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_draft_id_player_id_key UNIQUE (draft_id, player_id);

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_draft_id_seed_key UNIQUE (draft_id, seed);

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_pkey PRIMARY KEY (id);

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE playoff_draft_captains ADD CONSTRAINT playoff_draft_captains_seed_check CHECK ((seed >= 1));

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_captain_player_id_fkey FOREIGN KEY (captain_player_id) REFERENCES players(id);

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES playoff_drafts(id) ON DELETE CASCADE;

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_draft_id_pick_number_key UNIQUE (draft_id, pick_number);

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_draft_id_picked_player_id_key UNIQUE (draft_id, picked_player_id);

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_pick_number_check CHECK ((pick_number >= 1));

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_picked_player_id_fkey FOREIGN KEY (picked_player_id) REFERENCES players(id);

ALTER TABLE playoff_draft_picks ADD CONSTRAINT playoff_draft_picks_pkey PRIMARY KEY (id);

ALTER TABLE playoff_draft_pool ADD CONSTRAINT playoff_draft_pool_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES playoff_drafts(id) ON DELETE CASCADE;

ALTER TABLE playoff_draft_pool ADD CONSTRAINT playoff_draft_pool_draft_id_player_id_key UNIQUE (draft_id, player_id);

ALTER TABLE playoff_draft_pool ADD CONSTRAINT playoff_draft_pool_pkey PRIMARY KEY (id);

ALTER TABLE playoff_draft_pool ADD CONSTRAINT playoff_draft_pool_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_draft_type_check CHECK ((draft_type = ANY (ARRAY['snake'::text, 'straight'::text])));

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_pkey PRIMARY KEY (id);

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_season_id_key UNIQUE (season_id);

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_status_check CHECK ((status = ANY (ARRAY['setup'::text, 'drafting'::text, 'completed'::text, 'materialized'::text])));

ALTER TABLE playoff_drafts ADD CONSTRAINT playoff_drafts_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id);

ALTER TABLE push_category_prefs ADD CONSTRAINT push_category_prefs_category_id_fkey FOREIGN KEY (category_id) REFERENCES broadcast_categories(id) ON DELETE CASCADE;

ALTER TABLE push_category_prefs ADD CONSTRAINT push_category_prefs_pkey PRIMARY KEY (id);

ALTER TABLE push_category_prefs ADD CONSTRAINT push_category_prefs_player_id_category_id_key UNIQUE (player_id, category_id);

ALTER TABLE push_category_prefs ADD CONSTRAINT push_category_prefs_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE push_preferences ADD CONSTRAINT push_preferences_pkey PRIMARY KEY (player_id);

ALTER TABLE push_preferences ADD CONSTRAINT push_preferences_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_expo_push_token_key UNIQUE (expo_push_token);

ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);

ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));

ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

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

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_audience_check CHECK ((audience = ANY (ARRAY['rsvp_non_responders'::text, 'everyone'::text])));

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000)));

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_category_id_fkey FOREIGN KEY (category_id) REFERENCES broadcast_categories(id);

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_pkey PRIMARY KEY (id);

ALTER TABLE recurring_broadcast_schedules ADD CONSTRAINT recurring_broadcast_schedules_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));

ALTER TABLE registrations ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);

ALTER TABLE registrations ADD CONSTRAINT registrations_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_player_id_key UNIQUE (season_id, player_id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_pkey PRIMARY KEY (id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_status_check CHECK ((status = ANY (ARRAY['in'::text, 'out'::text])));

ALTER TABLE rsvp ADD CONSTRAINT rsvp_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id);

ALTER TABLE rsvp ADD CONSTRAINT rsvp_week_id_player_id_key UNIQUE (week_id, player_id);

ALTER TABLE rsvp_bonus_config ADD CONSTRAINT rsvp_bonus_config_bonus_amount_check CHECK ((bonus_amount > 0));

ALTER TABLE rsvp_bonus_config ADD CONSTRAINT rsvp_bonus_config_pkey PRIMARY KEY (id);

ALTER TABLE rsvp_bonus_config ADD CONSTRAINT rsvp_bonus_config_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE rsvp_bonus_config ADD CONSTRAINT rsvp_bonus_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES players(id) ON DELETE SET NULL;

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

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_pkey PRIMARY KEY (id);

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_reversed_mode_check CHECK ((reversed_mode = ANY (ARRAY['soft'::text, 'hard'::text, 'unarchive'::text])));

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'reversed'::text])));

ALTER TABLE week_archive_runs ADD CONSTRAINT week_archive_runs_week_id_fkey FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE;

ALTER TABLE week_archive_snapshot ADD CONSTRAINT week_archive_snapshot_kind_check CHECK ((kind = ANY (ARRAY['preexisting_id'::text, 'preimage_row'::text])));

ALTER TABLE week_archive_snapshot ADD CONSTRAINT week_archive_snapshot_phase_check CHECK ((phase = ANY (ARRAY['advance'::text, 'settle'::text])));

ALTER TABLE week_archive_snapshot ADD CONSTRAINT week_archive_snapshot_pkey PRIMARY KEY (id);

ALTER TABLE week_archive_snapshot ADD CONSTRAINT week_archive_snapshot_run_id_fkey FOREIGN KEY (run_id) REFERENCES week_archive_runs(id) ON DELETE CASCADE;

ALTER TABLE weeks ADD CONSTRAINT weeks_pkey PRIMARY KEY (id);

ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id);

ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_week_number_key UNIQUE (season_id, week_number);


-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX activity_feed_events_actor_player_id_idx ON public.activity_feed_events USING btree (actor_player_id);

CREATE INDEX activity_feed_events_auction_idx ON public.activity_feed_events USING btree (auction_id) WHERE (auction_id IS NOT NULL);

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

CREATE UNIQUE INDEX activity_feed_unique_auction_actor_event ON public.activity_feed_events USING btree (auction_id, event_type, actor_player_id) WHERE ((auction_id IS NOT NULL) AND (event_type = ANY (ARRAY['auction_check_bounce'::text, 'auction_won'::text])));

CREATE UNIQUE INDEX activity_feed_unique_auction_event ON public.activity_feed_events USING btree (auction_id, event_type) WHERE ((auction_id IS NOT NULL) AND (event_type <> ALL (ARRAY['auction_check_bounce'::text, 'auction_won'::text])));

CREATE UNIQUE INDEX activity_feed_unique_bet_event ON public.activity_feed_events USING btree (sportsbook_bet_id, event_type) WHERE (sportsbook_bet_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_bounty_event ON public.activity_feed_events USING btree (bounty_post_id, event_type) WHERE (bounty_post_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_loan_event ON public.activity_feed_events USING btree (loan_id, event_type) WHERE (loan_id IS NOT NULL);

CREATE UNIQUE INDEX activity_feed_unique_pvp_event ON public.activity_feed_events USING btree (pvp_challenge_id, event_type) WHERE (pvp_challenge_id IS NOT NULL);

CREATE UNIQUE INDEX app_version_config_singleton ON public.app_version_config USING btree ((true));

CREATE INDEX auction_bids_auction_idx ON public.auction_bids USING btree (auction_id);

CREATE UNIQUE INDEX auction_bids_one_active_per_player ON public.auction_bids USING btree (auction_id, player_id) WHERE (status = 'active'::text);

CREATE INDEX auction_bids_player_idx ON public.auction_bids USING btree (player_id);

CREATE INDEX auctions_catalog_idx ON public.auctions USING btree (catalog_item_id);

CREATE INDEX auctions_season_idx ON public.auctions USING btree (season_id);

CREATE INDEX auctions_status_closes_idx ON public.auctions USING btree (status, closes_at);

CREATE INDEX auctions_status_opens_idx ON public.auctions USING btree (status, opens_at);

CREATE INDEX auctions_winner_idx ON public.auctions USING btree (winner_player_id) WHERE (winner_player_id IS NOT NULL);

CREATE INDEX bet_haunts_bet_idx ON public.bet_haunts USING btree (bet_id);

CREATE INDEX bet_haunts_haunter_idx ON public.bet_haunts USING btree (haunter_player_id);

CREATE INDEX bet_haunts_season_idx ON public.bet_haunts USING btree (season_id);

CREATE UNIQUE INDEX bet_markets_combo_dedup ON public.bet_markets USING btree (week_id, ((params ->> 'combo_key'::text))) WHERE ((market_type = 'combo'::text) AND (status = ANY (ARRAY['open'::text, 'closed'::text])));

CREATE INDEX bets_custom_line_idx ON public.bets USING btree (custom_line_id);

CREATE INDEX bets_insurance_item_idx ON public.bets USING btree (insurance_item_id) WHERE (insurance_item_id IS NOT NULL);

CREATE INDEX bounty_hunter_stakes_player_idx ON public.bounty_hunter_stakes USING btree (player_id, bounty_post_id);

CREATE INDEX bounty_payouts_player_idx ON public.bounty_payouts USING btree (player_id);

CREATE INDEX bounty_payouts_post_idx ON public.bounty_payouts USING btree (bounty_post_id);

CREATE INDEX bounty_payouts_settlement_idx ON public.bounty_payouts USING btree (bounty_settlement_id);

CREATE INDEX bounty_post_board_idx ON public.bounty_post USING btree (season_id, status, closes_at, created_at DESC);

CREATE INDEX bounty_post_sponsor_idx ON public.bounty_post USING btree (sponsor_player_id) WHERE (sponsor_player_id IS NOT NULL);

CREATE INDEX bounty_post_week_board_idx ON public.bounty_post USING btree (week_id, status, closes_at);

CREATE INDEX bounty_settlements_admin_idx ON public.bounty_settlements USING btree (settled_by_admin_id);

CREATE UNIQUE INDEX bounty_settlements_one_per_post ON public.bounty_settlements USING btree (bounty_post_id);

CREATE INDEX broadcast_push_tickets_broadcast_idx ON public.broadcast_push_tickets USING btree (broadcast_id);

CREATE INDEX broadcast_push_tickets_pending_idx ON public.broadcast_push_tickets USING btree (created_at) WHERE (status = 'pending_receipt'::text);

CREATE INDEX broadcasts_due_idx ON public.broadcasts USING btree (scheduled_for) WHERE (status = 'pending'::text);

CREATE INDEX custom_lines_created_by_idx ON public.custom_lines USING btree (created_by_player_id);

CREATE INDEX games_team_a_id_idx ON public.games USING btree (team_a_id);

CREATE INDEX games_team_b_id_idx ON public.games USING btree (team_b_id);

CREATE INDEX idx_bet_legs_bet ON public.bet_legs USING btree (bet_id);

CREATE INDEX idx_bet_legs_selection ON public.bet_legs USING btree (selection_id);

CREATE INDEX idx_bet_markets_created_by ON public.bet_markets USING btree (created_by_player_id);

CREATE INDEX idx_bet_markets_status ON public.bet_markets USING btree (status);

CREATE INDEX idx_bet_markets_subject ON public.bet_markets USING btree (subject_player_id);

CREATE INDEX idx_bet_markets_subject_game ON public.bet_markets USING btree (subject_game_id);

CREATE INDEX idx_bet_markets_week ON public.bet_markets USING btree (week_id);

CREATE INDEX idx_bet_selections_market ON public.bet_selections USING btree (market_id);

CREATE INDEX idx_bets_player_season ON public.bets USING btree (player_id, season_id);

CREATE INDEX idx_bets_season ON public.bets USING btree (season_id);

CREATE INDEX idx_bets_status ON public.bets USING btree (status);

CREATE INDEX idx_bets_week ON public.bets USING btree (week_id);

CREATE INDEX idx_pin_ledger_bet ON public.pin_ledger USING btree (bet_id);

CREATE INDEX idx_pin_ledger_house ON public.pin_ledger USING btree (season_id) WHERE is_house;

CREATE INDEX idx_pin_ledger_player_season ON public.pin_ledger USING btree (player_id, season_id) INCLUDE (amount);

CREATE INDEX idx_pin_ledger_season ON public.pin_ledger USING btree (season_id);

CREATE INDEX lanetalk_game_imports_player_id_idx ON public.lanetalk_game_imports USING btree (player_id);

CREATE INDEX lanetalk_game_imports_week_id_idx ON public.lanetalk_game_imports USING btree (week_id);

CREATE INDEX loan_ledger_loan_id_idx ON public.loan_ledger USING btree (loan_id);

CREATE INDEX loan_ledger_pin_ledger_id_idx ON public.loan_ledger USING btree (pin_ledger_id);

CREATE INDEX loan_ledger_player_id_idx ON public.loan_ledger USING btree (player_id);

CREATE INDEX loan_ledger_season_id_idx ON public.loan_ledger USING btree (season_id);

CREATE INDEX loan_ledger_week_id_idx ON public.loan_ledger USING btree (week_id);

CREATE INDEX loan_products_season_id_idx ON public.loan_products USING btree (season_id);

CREATE INDEX loans_loan_product_id_idx ON public.loans USING btree (loan_product_id);

CREATE INDEX loans_player_id_idx ON public.loans USING btree (player_id);

CREATE INDEX loans_season_id_idx ON public.loans USING btree (season_id);

CREATE UNIQUE INDEX odds_engine_config_global_uniq ON public.odds_engine_config USING btree ((true)) WHERE (season_id IS NULL);

CREATE UNIQUE INDEX odds_engine_config_season_uniq ON public.odds_engine_config USING btree (season_id) WHERE (season_id IS NOT NULL);

CREATE INDEX pin_ledger_auction_idx ON public.pin_ledger USING btree (auction_id) WHERE (auction_id IS NOT NULL);

CREATE INDEX pin_ledger_bounty_post_id_idx ON public.pin_ledger USING btree (bounty_post_id);

CREATE INDEX pin_ledger_loan_ledger_id_idx ON public.pin_ledger USING btree (loan_ledger_id);

CREATE INDEX pin_ledger_pvp_ledger_id_idx ON public.pin_ledger USING btree (pvp_ledger_id);

CREATE INDEX pin_ledger_week_id_idx ON public.pin_ledger USING btree (week_id);

CREATE INDEX player_inventory_items_auction_idx ON public.player_inventory_items USING btree (auction_id) WHERE (auction_id IS NOT NULL);

CREATE INDEX player_inventory_items_catalog_idx ON public.player_inventory_items USING btree (catalog_item_id);

CREATE INDEX player_inventory_items_player_idx ON public.player_inventory_items USING btree (player_id);

CREATE INDEX player_inventory_items_season_idx ON public.player_inventory_items USING btree (season_id);

CREATE INDEX playoff_draft_captains_draft_idx ON public.playoff_draft_captains USING btree (draft_id);

CREATE INDEX playoff_draft_picks_draft_idx ON public.playoff_draft_picks USING btree (draft_id);

CREATE INDEX playoff_draft_pool_draft_idx ON public.playoff_draft_pool USING btree (draft_id);

CREATE INDEX push_category_prefs_player_idx ON public.push_category_prefs USING btree (player_id);

CREATE INDEX push_tokens_player_idx ON public.push_tokens USING btree (player_id);

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

CREATE UNIQUE INDEX rsvp_bonus_config_global_uniq ON public.rsvp_bonus_config USING btree ((true)) WHERE (season_id IS NULL);

CREATE UNIQUE INDEX rsvp_bonus_config_season_uniq ON public.rsvp_bonus_config USING btree (season_id) WHERE (season_id IS NOT NULL);

CREATE INDEX rsvp_player_id_idx ON public.rsvp USING btree (player_id);

CREATE INDEX scores_game_id_idx ON public.scores USING btree (game_id);

CREATE UNIQUE INDEX seasons_single_active ON public.seasons USING btree (is_active) WHERE is_active;

CREATE INDEX team_slots_player_id_idx ON public.team_slots USING btree (player_id);

CREATE INDEX team_slots_team_id_idx ON public.team_slots USING btree (team_id);

CREATE INDEX week_archive_runs_week_id_idx ON public.week_archive_runs USING btree (week_id, status);

CREATE INDEX week_archive_snapshot_run_idx ON public.week_archive_snapshot USING btree (run_id, table_name, kind);

CREATE INDEX weeks_advanced_unsettled_idx ON public.weeks USING btree (season_id) WHERE ((is_archived = true) AND (settled_at IS NULL));


-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE activity_event_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can write" ON activity_event_catalog AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON activity_event_catalog AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE activity_feed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON activity_feed_events AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON activity_feed_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can read all" ON activity_feed_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON activity_feed_events AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read public published" ON activity_feed_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((status = 'published'::text) AND (visibility = 'public'::text)));

ALTER TABLE app_version_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage" ON app_version_config AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "authenticated can read" ON app_version_config AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read own bids" ON auction_bids AS PERMISSIVE FOR SELECT TO authenticated
  USING ((player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE auction_house_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read auction house state" ON auction_house_state AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read auctions" ON auctions AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_haunts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "haunter, admin, or revealed-on-win can read" ON bet_haunts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR (haunter_player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM bets b
  WHERE ((b.id = bet_haunts.bet_id) AND (b.status = 'won'::text))))));

ALTER TABLE bet_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_legs AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bet_legs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bet_legs AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bet_legs AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_markets AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bet_markets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bet_markets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bet_markets AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bet_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bet_selections AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bet_selections AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bet_selections AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bet_selections AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bets AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bets AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE board_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can delete own" ON board_posts AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_admin() AS is_admin)));

CREATE POLICY "authenticated can insert" ON board_posts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "authenticated can read" ON board_posts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_hunter_stakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_hunter_stakes AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bounty_hunter_stakes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bounty_hunter_stakes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bounty_hunter_stakes AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_payouts AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bounty_payouts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bounty_payouts AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bounty_payouts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_post ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_post AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bounty_post AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bounty_post AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bounty_post AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE bounty_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON bounty_settlements AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON bounty_settlements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON bounty_settlements AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON bounty_settlements AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE broadcast_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read categories" ON broadcast_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE broadcast_event_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage event rules" ON broadcast_event_rules AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

ALTER TABLE broadcast_push_tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can insert broadcasts" ON broadcasts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can read broadcasts" ON broadcasts AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT is_admin() AS is_admin));

ALTER TABLE custom_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON custom_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON custom_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON custom_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON custom_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON games AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON games AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON games AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE item_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read catalog" ON item_catalog AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE lanetalk_game_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can update" ON lanetalk_game_imports AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON lanetalk_game_imports AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loan_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loan_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON loan_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON loan_ledger AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON loan_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loan_products AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON loan_products AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON loan_products AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON loan_products AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON loans AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON loans AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON loans AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON loans AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE odds_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage" ON odds_engine_config AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "authenticated can read" ON odds_engine_config AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE odds_engine_stat_corr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage" ON odds_engine_stat_corr AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "authenticated can read" ON odds_engine_stat_corr AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pin_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON pin_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON pin_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE player_inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner or admin can read inventory" ON player_inventory_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR (player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can insert" ON players AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON players AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON players AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE playoff_draft_captains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can write" ON playoff_draft_captains AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON playoff_draft_captains AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE playoff_draft_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can write" ON playoff_draft_picks AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON playoff_draft_picks AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE playoff_draft_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can write" ON playoff_draft_pool AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON playoff_draft_pool AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE playoff_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can write" ON playoff_drafts AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON playoff_drafts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE push_category_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own category prefs insert" ON push_category_prefs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "own category prefs or admin can read" ON push_category_prefs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR (player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "own category prefs update" ON push_category_prefs AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE push_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prefs insert" ON push_preferences AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "own prefs or admin can read" ON push_preferences AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR (player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "own prefs update" ON push_preferences AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((player_id IN ( SELECT p.id
   FROM players p
  WHERE (p.user_id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE pvp_challenge_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_challenge_offers AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON pvp_challenge_offers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON pvp_challenge_offers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON pvp_challenge_offers AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pvp_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_challenges AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON pvp_challenges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON pvp_challenges AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON pvp_challenges AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE pvp_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON pvp_ledger AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON pvp_ledger AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON pvp_ledger AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON pvp_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE recurring_broadcast_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage recurring schedules" ON recurring_broadcast_schedules AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY registrations_delete ON registrations AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_admin() AS is_admin)));

CREATE POLICY registrations_insert ON registrations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_admin() AS is_admin)));

CREATE POLICY registrations_select ON registrations AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY registrations_update ON registrations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

ALTER TABLE rsvp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage rsvp" ON rsvp AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON rsvp AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "player can manage own rsvp" ON rsvp AS PERMISSIVE FOR ALL TO authenticated
  USING ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE rsvp_bonus_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage" ON rsvp_bonus_config AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "authenticated can read" ON rsvp_bonus_config AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON scores AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON scores AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON scores AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON scores AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE season_champions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON season_champions AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON season_champions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON season_champions AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON seasons AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON seasons AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON seasons AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON seasons AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE team_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON team_slots AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON team_slots AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON team_slots AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON team_slots AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can delete" ON teams AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can insert" ON teams AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON teams AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "authenticated can read" ON teams AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE week_archive_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read runs" ON week_archive_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT is_admin() AS is_admin));

ALTER TABLE week_archive_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read snapshot" ON week_archive_snapshot AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT is_admin() AS is_admin));

ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can insert" ON weeks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));

CREATE POLICY "admin can update" ON weeks AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));

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
  v_pin_p1_player  uuid;
  v_pin_p1_house   uuid;
  v_pin_p2_player  uuid;
  v_pin_p2_house   uuid;
  v_pvp_stake1     uuid;
  v_pvp_stake2     uuid;
  v_counterparty   uuid;
BEGIN
  v_caller_id := public.current_player_id();

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

  IF public.pin_balance(v_challenge.creator_player_id, v_challenge.season_id) < v_challenge.creator_stake THEN
    RAISE EXCEPTION 'Creator has insufficient balance';
  END IF;

  IF public.pin_balance(v_counterparty, v_challenge.season_id) < v_challenge.counterparty_stake THEN
    RAISE EXCEPTION 'Counterparty has insufficient balance';
  END IF;

  -- Escrow creator's stake (double-entry: player -stake, house +stake).
  SELECT player_entry_id, house_entry_id INTO v_pin_p1_player, v_pin_p1_house
    FROM public.pin_ledger_double_entry(
      v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
      -v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed');

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.creator_stake, 'stake', 'Creator stake escrowed', v_pin_p1_player)
    RETURNING id INTO v_pvp_stake1;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake1 WHERE id IN (v_pin_p1_player, v_pin_p1_house);

  -- Escrow counterparty's stake.
  SELECT player_entry_id, house_entry_id INTO v_pin_p2_player, v_pin_p2_house
    FROM public.pin_ledger_double_entry(
      v_counterparty, v_challenge.season_id, v_challenge.week_id,
      -v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed');

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

CREATE OR REPLACE FUNCTION public.admin_grant_rsvp_bonus(p_player_id uuid, p_week_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_week    public.weeks%ROWTYPE;
  v_season  public.seasons%ROWTYPE;
  v_cfg     public.rsvp_bonus_config%ROWTYPE;
  v_desc    text;
  v_awarded boolean := false;
  v_amount  integer := 0;
  v_reason  text;
BEGIN
  PERFORM public.assert_admin();

  IF p_player_id IS NULL OR p_week_id IS NULL THEN
    RAISE EXCEPTION 'player id and week id are required';
  END IF;

  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = v_week.season_id;

  -- The player must actually have an RSVP on record for this week.
  IF NOT EXISTS (
    SELECT 1 FROM public.rsvp
    WHERE player_id = p_player_id AND week_id = p_week_id
  ) THEN
    v_reason := 'no_rsvp';
  ELSIF EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE player_id = p_player_id AND week_id = p_week_id AND type = 'rsvp_bonus'
  ) THEN
    v_reason := 'already_claimed';
  ELSE
    -- Config resolution: current-season row first, else global (same as
    -- submit_own_rsvp). Only the amount is honored — is_enabled and the
    -- deadline are intentionally not checked here.
    SELECT * INTO v_cfg FROM public.rsvp_bonus_config
      WHERE season_id = v_week.season_id;
    IF v_cfg.id IS NULL THEN
      SELECT * INTO v_cfg FROM public.rsvp_bonus_config
        WHERE season_id IS NULL;
    END IF;

    IF v_cfg.id IS NULL THEN
      v_reason := 'disabled';
    ELSE
      v_desc := format('RSVP Bonus - Season %s Week %s', v_season.number, v_week.week_number);
      PERFORM public.pin_ledger_double_entry(
        p_player_id, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        v_desc, v_desc || ' (House)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.advance_week(p_week_id uuid, p_force boolean DEFAULT false, p_fill_scores jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_week_number  integer;
  v_actor_id     uuid;
  v_run_id       uuid;
  v_n_fill       integer := 0;
  v_n_bad        integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.week_archive_runs WHERE week_id = p_week_id AND status = 'active') THEN
    RAISE EXCEPTION 'Week already has an active archive run — unarchive it first';
  END IF;

  SELECT id INTO v_actor_id FROM public.players WHERE user_id = (SELECT auth.uid());

  INSERT INTO public.week_archive_runs (week_id, season_id, actor_id)
    VALUES (p_week_id, v_season_id, v_actor_id)
    RETURNING id INTO v_run_id;

  -- Materialize unscored fill scores (the values the live screen showed), and
  -- snapshot ONLY those preimages, phase='advance'. Money preimages/ids are
  -- captured later, in settle_week (phase='settle').
  IF p_fill_scores IS NOT NULL AND jsonb_typeof(p_fill_scores) = 'array'
     AND jsonb_array_length(p_fill_scores) > 0 THEN

    SELECT count(*) INTO v_n_bad
      FROM jsonb_to_recordset(p_fill_scores)
             AS f(team_slot_id uuid, game_id uuid, score integer)
      LEFT JOIN public.scores s      ON s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id
      LEFT JOIN public.team_slots ts ON ts.id = f.team_slot_id
      LEFT JOIN public.teams t       ON t.id = ts.team_id
     WHERE s.id IS NULL
        OR t.week_id IS DISTINCT FROM p_week_id
        OR ts.is_fill IS DISTINCT FROM true
        OR s.score IS NOT NULL
        OR f.score IS NULL OR f.score < 1;
    IF v_n_bad > 0 THEN
      RAISE EXCEPTION 'Invalid or stale fill-score payload (% row(s)) — scores changed since the screen loaded; close and retry', v_n_bad;
    END IF;

    SELECT count(*) INTO v_n_fill
      FROM (SELECT DISTINCT team_slot_id, game_id
              FROM jsonb_to_recordset(p_fill_scores)
                     AS f(team_slot_id uuid, game_id uuid, score integer)) d;
    IF v_n_fill <> jsonb_array_length(p_fill_scores) THEN
      RAISE EXCEPTION 'Duplicate rows in fill-score payload';
    END IF;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'scores', s.id, jsonb_build_object('score', s.score), 'advance'
      FROM jsonb_to_recordset(p_fill_scores) AS f(team_slot_id uuid, game_id uuid, score integer)
      JOIN public.scores s ON s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id;

    UPDATE public.scores s SET score = f.score
      FROM jsonb_to_recordset(p_fill_scores) AS f(team_slot_id uuid, game_id uuid, score integer)
     WHERE s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id;
  END IF;

  -- Coverage guard: no unscored fill row may survive into settlement.
  IF EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND ts.is_fill AND s.score IS NULL)
     AND EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND s.score IS NOT NULL)
     AND EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
               JOIN public.weeks w       ON w.id = t.week_id
              WHERE w.is_archived AND ts.is_fill = false
                AND ts.player_id IS NOT NULL AND s.score > 0)
  THEN
    RAISE EXCEPTION 'Unscored fill slots remain — the archive did not receive their on-screen values (p_fill_scores). Update the app and retry, or enter the fill scores manually.';
  END IF;

  -- Lock the week. NO bowled_at write — bowled_at is the immutable scheduled
  -- bowl-Monday (set at creation) so the next-day LaneTalk import still binds.
  UPDATE public.weeks SET is_archived = true WHERE id = p_week_id;

  -- Create N+1 (idempotent) — the weeks_derive_bowled_at trigger fills its
  -- scheduled bowled_at.
  INSERT INTO public.weeks (season_id, week_number)
    VALUES (v_season_id, v_week_number + 1)
    ON CONFLICT (season_id, week_number) DO NOTHING;

  RETURN v_run_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_week(p_week_id uuid, p_force boolean DEFAULT false, p_fill_scores jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  v_run_id := public.advance_week(p_week_id, p_force, p_fill_scores);
  PERFORM public.settle_week(p_week_id, false, p_force);
  RETURN v_run_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auction_bid_key()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.auction_bidders(p_auction_id uuid)
 RETURNS TABLE(player_id uuid, player_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT b.player_id, p.name
    FROM public.auction_bids b
    JOIN public.players p ON p.id = b.player_id
    JOIN public.auctions a ON a.id = b.auction_id
   WHERE b.auction_id = p_auction_id
     AND b.status = 'active'
     AND a.status = 'open'
   ORDER BY p.name;
$function$
;

CREATE OR REPLACE FUNCTION public.bet_mint_rung_internal(p_market_id uuid, p_line numeric, p_quoted_odds numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt      public.bet_markets;
  v_line     numeric;
  v_cfg      public.odds_engine_config;
  v_d        record;
  v_sel      record;
  v_over     numeric;
  v_under    numeric;
BEGIN
  IF p_quoted_odds IS NULL OR p_quoted_odds <= 1.0 THEN
    RAISE EXCEPTION 'A quoted price is required to take a line';
  END IF;

  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_mkt.status <> 'open' THEN
    RAISE EXCEPTION 'A selected market is not open';
  END IF;

  IF p_line IS NULL OR p_line <> floor(p_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', p_line;
  END IF;
  -- Canonical numeric text: '4.50'::numeric and '4.5'::numeric must build the
  -- SAME 'over:<line>' key the ladder minter builds (its lines come out of
  -- seed + j × spacing arithmetic, minimal scale).
  v_line := trim_scale(p_line);

  SELECT * INTO v_d FROM public.odds_engine_market_distribution(p_market_id);
  v_cfg := public.odds_engine_get_config(v_d.season_id);

  -- Posted rung → the book's standing offer wins; the quote just has to
  -- agree with it within tolerance.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NOT NULL THEN
    IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
      RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
    END IF;
    RETURN v_sel.id;
  END IF;

  -- Fresh mint: price inside the custom band; out-of-band lines are simply
  -- not offered. Engine off → nothing beyond the posted pair is offered.
  IF NOT v_cfg.is_enabled THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF v_line < v_d.range_lo OR v_line > v_d.range_hi THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  -- The offer floor: the smallest line paying the configured minimum
  -- multiplier — the SAME edge odds_engine_quote_internal advertises as
  -- min_line (posted rungs above were already reused verbatim; the seed is
  -- always posted, so seed-containment needs no special case here).
  IF v_line < ceil((v_d.mean * GREATEST(v_d.n_games, 1)
                    + public.odds_engine_norm_ppf(1.0 - 1.0 / COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min))
                      * sqrt(v_d.variance * GREATEST(v_d.n_games, 1)))::numeric - 0.5) + 0.5 THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
    FROM public.odds_engine_price_pair(v_d.mean, v_d.variance, v_d.n_games, v_line,
                                       COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
                                       COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max),
                                       false) pp;
  IF v_over IS NULL THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF abs(v_over - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_over;
  END IF;

  -- Mint the PAIR at the fresh price. sort_order 100 + 2·line keeps custom
  -- rungs stable, collision-free (half-point lines step in whole units of
  -- 2·line), and after the generated ladder's 0..13; the client orders by
  -- line anyway.
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    VALUES
      (p_market_id, 'over:'  || v_line, 'Over',  v_over,  v_line, 100 + (v_line * 2)::integer, 'over'),
      (p_market_id, 'under:' || v_line, 'Under', v_under, v_line, 101 + (v_line * 2)::integer, 'under')
    ON CONFLICT (market_id, key) DO NOTHING;

  -- Re-read: on a concurrent mint the unique constraint arbitrates and the
  -- winner's posted price stands — tolerance-check it like any posted rung.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NULL THEN
    RAISE EXCEPTION 'Could not mint the requested line';
  END IF;
  IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
  END IF;
  RETURN v_sel.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bet_selections_fill_side()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.side IS NULL THEN
    NEW.side := CASE
      WHEN NEW.key = 'over'  OR NEW.key LIKE 'over:%'  THEN 'over'
      WHEN NEW.key = 'under' OR NEW.key LIKE 'under:%' THEN 'under'
      ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.broadcast_cancel(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.broadcasts
     SET status = 'canceled'
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a pending broadcast can be canceled';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.broadcast_reach(p_category_id uuid, p_target_player_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(targeted integer, reachable integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT
      CASE WHEN p_target_player_ids IS NULL
           THEN (SELECT count(*) FROM public.players WHERE is_active)::integer
           ELSE cardinality(p_target_player_ids) END,
      (SELECT count(DISTINCT r.player_id)
         FROM public.broadcast_recipients(p_category_id, p_target_player_ids) r)::integer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.broadcast_recipients(p_category_id uuid, p_target_player_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(player_id uuid, expo_push_token text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT t.player_id, t.expo_push_token
    FROM public.push_tokens t
    JOIN public.players pl ON pl.id = t.player_id
   WHERE pl.is_active
     AND (p_target_player_ids IS NULL OR t.player_id = ANY (p_target_player_ids))
     AND NOT EXISTS (
       SELECT 1 FROM public.push_preferences pp
        WHERE pp.player_id = t.player_id AND pp.master_enabled = false
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.push_category_prefs cp
        WHERE cp.player_id = t.player_id
          AND cp.category_id = p_category_id
          AND cp.enabled = false
     );
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_auction(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_admin();

  SELECT status INTO v_status FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_status = 'settled' THEN
    RAISE EXCEPTION 'Settled auctions are reversed, not cancelled';
  END IF;
  -- Defensive: no money can have moved pre-settlement.
  IF EXISTS (SELECT 1 FROM public.pin_ledger WHERE auction_id = p_auction_id) THEN
    RAISE EXCEPTION 'Auction has ledger rows — refusing to cancel';
  END IF;

  -- Bids cascade; feed rows cascade (M6 FK); inventory can't exist pre-settlement.
  DELETE FROM public.auctions WHERE id = p_auction_id;
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
  PERFORM public.assert_admin();

  -- Markets this bet touched (captured before the bet is deleted).
  SELECT ARRAY_AGG(DISTINCT s.market_id) INTO v_market_ids
  FROM public.bet_legs l
  JOIN public.bet_selections s ON s.id = l.selection_id
  WHERE l.bet_id = p_bet_id;

  -- Restore the attached items consumed at placement (consumed_at back to NULL on
  -- the exact rows the bet points at). The only sanctioned un-spend.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT insurance_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT crutch_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT boost_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;

  -- Restore every ghost's ticket too — a haunt on a cancelled bet never resolved,
  -- so the haunter gets their Ghost back. The bet_haunts rows themselves cascade
  -- away with the bet delete below.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id IN (SELECT inventory_item_id FROM public.bet_haunts WHERE bet_id = p_bet_id)
     AND consumed_at IS NOT NULL;

  DELETE FROM public.pin_ledger WHERE bet_id = p_bet_id;
  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Sweep the touched markets now that the bet is gone:
  --  • a betless COMBO is deleted outright (compose = bet: a combo market
  --    never exists without a bet riding it — off the board, recompose mints
  --    a new one);
  --  • any other betless SETTLED market re-opens (its result derived from a
  --    bet that no longer exists).
  IF v_market_ids IS NOT NULL THEN
    FOREACH v_mid IN ARRAY v_market_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        WHERE s.market_id = v_mid
      ) THEN
        IF EXISTS (
          SELECT 1 FROM public.bet_markets WHERE id = v_mid AND market_type = 'combo'
        ) THEN
          DELETE FROM public.bet_markets WHERE id = v_mid;
        ELSIF EXISTS (
          SELECT 1 FROM public.bet_markets WHERE id = v_mid AND status = 'settled'
        ) THEN
          UPDATE public.bet_markets
            SET status = 'open', result_value = NULL, settled_at = NULL
            WHERE id = v_mid;
          UPDATE public.bet_selections SET result = NULL WHERE market_id = v_mid;
        END IF;
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
  PERFORM public.assert_admin();

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
  PERFORM public.assert_admin();

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

  v_is_admin := public.is_admin();

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
  PERFORM public.assert_admin();

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
  PERFORM public.assert_admin();

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
    SET status = 'expired'
    WHERE c.week_id = p_week_id
      AND c.status IN ('pending', 'countered')
      AND (p_game_number IS NULL OR c.game_number = p_game_number);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.combo_member_averages(p_player_ids uuid[], p_stat text, p_season_id uuid)
 RETURNS TABLE(player_id uuid, avg_per_game numeric, games integer, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_league_avg numeric;
BEGIN
  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    RETURN QUERY
    SELECT mem.pid,
           CASE WHEN ssn.n > 0 THEN ssn.avg_stat
                WHEN life.n > 0 THEN life.avg_stat END,
           CASE WHEN ssn.n > 0 THEN ssn.n
                WHEN life.n > 0 THEN life.n
                ELSE 0 END,
           CASE WHEN ssn.n > 0 THEN 'season'
                WHEN life.n > 0 THEN 'lifetime' END
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat,
             count(*)::integer AS n
      FROM public.lanetalk_game_imports i
      JOIN public.weeks w ON w.id = i.week_id
      WHERE i.player_id = mem.pid
        AND i.classification = 'official' AND i.frames > 0
        AND w.season_id = p_season_id
    ) ssn
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat,
             count(*)::integer AS n
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.pid
        AND i.classification = 'official' AND i.frames > 0
    ) life;

  ELSIF p_stat = 'total_pins' THEN
    -- player_raw_avg_score's league rung, computed once for the batch.
    SELECT COALESCE(avg(s.score), 130) INTO v_league_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;

    RETURN QUERY
    SELECT mem.pid,
           CASE WHEN ssn.n > 0 THEN ssn.avg_score
                WHEN life.n > 0 THEN life.avg_score
                ELSE v_league_avg END,
           CASE WHEN ssn.n > 0 THEN ssn.n
                WHEN life.n > 0 THEN life.n
                ELSE 0 END,
           CASE WHEN ssn.n > 0 THEN 'season'
                WHEN life.n > 0 THEN 'lifetime'
                ELSE 'league' END
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT avg(s.score) AS avg_score, count(*)::integer AS n
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.season_id = p_season_id AND w.is_archived = true
        AND ts.player_id = mem.pid AND s.score > 0
    ) ssn
    CROSS JOIN LATERAL (
      SELECT avg(s.score) AS avg_score, count(*)::integer AS n
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id = mem.pid AND s.score > 0
    ) life;

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.combo_preview_ladder(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1, p_week_id uuid DEFAULT NULL::uuid, p_game_number integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_members      uuid[];
  v_member_texts text[];
  v_scope        text;
  v_combo_key    text;
  v_mkt          uuid;
  v_seed         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_spacing      numeric;
  v_hi           numeric;
  v_cn           integer := GREATEST(COALESCE(p_n_games, 1), 1);
  v_out          jsonb;
BEGIN
  IF p_stat IS NULL OR p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', COALESCE(p_stat, '(null)');
  END IF;

  SELECT array_agg(m ORDER BY m) INTO v_members
    FROM (SELECT DISTINCT m FROM unnest(COALESCE(p_member_ids, '{}')) m) d;
  IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Existing open combo for the same key → its posted rungs ARE the offer
  -- (a second bettor can only take lines the market already carries).
  IF p_week_id IS NOT NULL THEN
    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_scope := CASE WHEN p_game_number IS NULL THEN 'night' ELSE 'game' END;
    v_combo_key := p_stat || '|' || v_scope || '|' || COALESCE(p_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');
    SELECT m.id INTO v_mkt
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status = 'open' AND m.params ->> 'combo_key' = v_combo_key;
    IF v_mkt IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object(
               'line', s.line, 'odds', s.odds, 'is_seed', s.key = 'over')
             ORDER BY s.line)
        INTO v_out
        FROM public.bet_selections s
        WHERE s.market_id = v_mkt AND s.side = 'over';
      RETURN COALESCE(v_out, '[]'::jsonb);
    END IF;
  END IF;

  v_seed := public.combo_seed_line(v_members, p_stat, p_season_id, v_cn);

  SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
    INTO v_mean, v_var
    FROM unnest(v_members) mem(m)
    CROSS JOIN LATERAL public.odds_engine_player_stat(
      mem.m, p_season_id,
      CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END) ps;

  v_cfg := public.odds_engine_get_config(p_season_id);
  v_spacing := CASE
    WHEN p_stat <> 'total_pins' THEN v_cfg.spacing_count
    WHEN v_cn = 1 THEN v_cfg.spacing_score
    ELSE v_cfg.spacing_night_pins END;
  v_hi := CASE WHEN p_stat = 'total_pins'
               THEN 220 * v_cn * array_length(v_members, 1) + 0.5
               ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

  SELECT jsonb_agg(jsonb_build_object(
           'line', bl.line, 'odds', bl.odds, 'is_seed', bl.key = 'over')
         ORDER BY bl.line)
    INTO v_out
    FROM public.odds_engine_build_ladder(v_seed, v_mean, v_var, v_cn,
                                         v_spacing, 0.5, v_hi, p_season_id) bl
    WHERE bl.side = 'over';
  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.combo_price_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1, p_week_id uuid DEFAULT NULL::uuid, p_game_number integer DEFAULT NULL::integer, p_line numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_members      uuid[];
  v_member_texts text[];
  v_scope        text;
  v_combo_key    text;
  v_mkt          uuid;
  v_seed_line    numeric;
  v_seed_odds    numeric;
  v_posted       numeric;
  v_line         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_hi           numeric;
  v_cn           integer := GREATEST(COALESCE(p_n_games, 1), 1);
BEGIN
  IF p_stat IS NULL OR p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', COALESCE(p_stat, '(null)');
  END IF;

  SELECT array_agg(m ORDER BY m) INTO v_members
    FROM (SELECT DISTINCT m FROM unnest(COALESCE(p_member_ids, '{}')) m) d;
  IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
    RAISE EXCEPTION 'A combo needs at least two distinct players';
  END IF;

  -- Existing open combo for the same key → its seed anchors the editor and
  -- its posted rungs echo verbatim.
  IF p_week_id IS NOT NULL THEN
    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_scope := CASE WHEN p_game_number IS NULL THEN 'night' ELSE 'game' END;
    v_combo_key := p_stat || '|' || v_scope || '|' || COALESCE(p_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');
    SELECT m.id INTO v_mkt
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status = 'open' AND m.params ->> 'combo_key' = v_combo_key;
  END IF;

  IF v_mkt IS NOT NULL THEN
    SELECT s.line, s.odds INTO v_seed_line, v_seed_odds
      FROM public.bet_selections s
      WHERE s.market_id = v_mkt AND s.key = 'over';
  ELSE
    v_seed_line := public.combo_seed_line(v_members, p_stat, p_season_id, v_cn);
  END IF;

  v_line := COALESCE(p_line, v_seed_line);
  IF v_line <> floor(v_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', v_line;
  END IF;

  IF v_mkt IS NOT NULL THEN
    SELECT s.odds INTO v_posted
      FROM public.bet_selections s
      WHERE s.market_id = v_mkt AND s.side = 'over' AND s.line = v_line;
  END IF;

  SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
    INTO v_mean, v_var
    FROM unnest(v_members) mem(m)
    CROSS JOIN LATERAL public.odds_engine_player_stat(
      mem.m, p_season_id,
      CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END) ps;

  v_cfg := public.odds_engine_get_config(p_season_id);
  v_hi := CASE WHEN p_stat = 'total_pins'
               THEN 220 * v_cn * array_length(v_members, 1) + 0.5
               ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

  RETURN public.odds_engine_quote_internal(
    v_line, v_seed_line, v_seed_odds, v_posted,
    v_cfg.is_enabled, v_mean, NULLIF(v_var, 0), v_cn,
    0.5, v_hi,
    COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
    COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.combo_seed_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n_members integer;
  v_sum       numeric;
BEGIN
  SELECT count(DISTINCT m) INTO v_n_members FROM unnest(p_member_ids) m;
  IF v_n_members = 0 THEN v_n_members := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    -- Per member: floor(per-game avg × games) = their solo whole-number base
    -- (no data → 0). Summed bases + ONE half point.
    SELECT COALESCE(SUM(floor(COALESCE(pl.avg_stat, 0) * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl;
    -- Clamp to [0.5, 10 frames/game × games × members − 0.5].
    RETURN LEAST(10 * p_n_games * v_n_members - 0.5,
                 GREATEST(0.5, v_sum + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(floor(public.player_raw_avg_score(mem.player_id, p_season_id) * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem;
    RETURN GREATEST(0.5, v_sum + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compose_combo_bet(p_week_id uuid, p_combos jsonb, p_stake integer, p_extra_selection_ids uuid[] DEFAULT NULL::uuid[], p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid, p_extra_picks jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id    uuid;
  v_season_id    uuid;
  v_archived     boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_spec         jsonb;
  v_stat         text;
  v_scope        text;
  v_game_number  integer;
  v_members      uuid[];
  v_member_texts text[];
  v_member_names text[];
  v_n_named      integer;
  v_combo_key    text;
  v_existing     record;
  v_clock        text;
  v_label        text;
  v_line         numeric;
  v_market_id    uuid;
  v_over_id      uuid;
  v_deduped      boolean;
  v_market_ids   uuid[] := '{}';
  v_over_ids     uuid[] := '{}';
  v_combos_out   jsonb := '[]'::jsonb;
  v_first_created jsonb := NULL;
  v_n_created    integer := 0;
  v_bet_id       uuid;
  v_spec_line    numeric;
  v_spec_quote   numeric;
  v_odds         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_spacing      numeric;
  v_hi           numeric;
  v_cn           integer;
  v_pick         jsonb;
  v_extra_ids    uuid[] := '{}';
  v_pick_market  uuid;
BEGIN
  v_player_id := public.current_player_id();

  SELECT w.season_id, w.is_archived INTO v_season_id, v_archived
    FROM public.weeks w WHERE w.id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF v_archived THEN
    RAISE EXCEPTION 'This week is locked — no new bets can be placed';
  END IF;

  IF p_combos IS NULL OR jsonb_typeof(p_combos) <> 'array' OR jsonb_array_length(p_combos) < 1 THEN
    RAISE EXCEPTION 'At least one combo is required';
  END IF;

  -- Schedule games: the games table is authoritative once a schedule exists;
  -- before teams, default {1, 2} (the O/U sync's pre-teams convention).
  SELECT ARRAY(
    SELECT DISTINCT g.game_number FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
    ORDER BY 1
  ) INTO v_target_games;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);
  v_cfg := public.odds_engine_get_config(v_season_id);

  -- One coarse lock per week serializes identical composes without per-spec
  -- lock-ordering concerns; the partial unique index is the backstop.
  PERFORM pg_advisory_xact_lock(hashtextextended('combo|' || p_week_id::text, 0));

  FOR v_spec IN SELECT value FROM jsonb_array_elements(p_combos) LOOP
    v_stat := v_spec ->> 'stat';
    v_scope := v_spec ->> 'scope';
    v_game_number := (v_spec ->> 'game_number')::integer;
    -- Optional chosen rung: NULL means the seed rung (canonical 'over' key).
    -- With a quoted price attached, an UNPOSTED chosen line mints on demand
    -- (bet_mint_rung_internal); without one, legacy behavior — posted rungs
    -- only.
    v_spec_line := (v_spec ->> 'line')::numeric;
    v_spec_quote := (v_spec ->> 'quoted_odds')::numeric;

    IF v_stat IS NULL OR v_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
      RAISE EXCEPTION 'Unknown combo stat %', COALESCE(v_stat, '(null)');
    END IF;
    IF v_scope IS NULL OR v_scope NOT IN ('game', 'night') THEN
      RAISE EXCEPTION 'Combo scope must be game or night';
    END IF;
    IF v_scope = 'game' THEN
      IF v_game_number IS NULL OR NOT (v_game_number = ANY (v_target_games)) THEN
        RAISE EXCEPTION 'Game % is not on this week''s schedule', COALESCE(v_game_number::text, '(null)');
      END IF;
    ELSIF v_game_number IS NOT NULL THEN
      RAISE EXCEPTION 'A night combo cannot carry a game number';
    END IF;

    -- Members: sorted + deduped; at least two; every member RSVP''d in.
    SELECT array_agg(m ORDER BY m) INTO v_members
      FROM (SELECT DISTINCT (mem.value)::uuid AS m
              FROM jsonb_array_elements_text(COALESCE(v_spec -> 'member_ids', '[]'::jsonb)) mem
             WHERE mem.value IS NOT NULL) d;
    IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
      RAISE EXCEPTION 'A combo needs at least two distinct players';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_members) mem
      WHERE NOT EXISTS (
        SELECT 1 FROM public.rsvp r
        WHERE r.week_id = p_week_id AND r.player_id = mem AND r.status = 'in')
    ) THEN
      RAISE EXCEPTION 'Every combo member must be RSVP''d in for this week';
    END IF;

    -- Display-name snapshot (also proves every id is a real player).
    SELECT array_agg(p.name ORDER BY mem.ord), count(p.id)
      INTO v_member_names, v_n_named
      FROM unnest(v_members) WITH ORDINALITY mem(id, ord)
      JOIN public.players p ON p.id = mem.id;
    IF v_n_named <> array_length(v_members, 1) THEN
      RAISE EXCEPTION 'Unknown player in combo';
    END IF;

    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_combo_key := v_stat || '|' || v_scope || '|' || COALESCE(v_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');

    SELECT m.id, m.status INTO v_existing
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status IN ('open', 'closed')
        AND m.params ->> 'combo_key' = v_combo_key;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.status <> 'open' THEN
        RAISE EXCEPTION 'This combo is in progress — betting is closed';
      END IF;
      v_market_id := v_existing.id;
      v_deduped := true;
      IF v_spec_line IS NULL THEN
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.key = 'over';
      ELSIF v_spec_quote IS NOT NULL THEN
        -- Quoted spec: posted rungs reuse (tolerance-checked inside), unposted
        -- lines mint at the fresh price.
        v_over_id := public.bet_mint_rung_internal(v_market_id, v_spec_line, v_spec_quote);
        SELECT s.line, s.odds INTO v_line, v_odds
          FROM public.bet_selections s WHERE s.id = v_over_id;
      ELSE
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.side = 'over' AND s.line = v_spec_line;
        IF v_over_id IS NULL THEN
          RAISE EXCEPTION 'This combo already exists at other lines — pick one of its posted rungs';
        END IF;
      END IF;
    ELSE
      v_deduped := false;
      v_clock := CASE WHEN v_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
      v_label := CASE v_stat
                   WHEN 'clean_frames' THEN 'Clean Frames'
                   WHEN 'strikes'      THEN 'Strikes'
                   WHEN 'spares'       THEN 'Spares'
                   ELSE 'Total Pins' END;
      v_line := public.combo_seed_line(v_members, v_stat, v_season_id,
                  CASE WHEN v_scope = 'game' THEN 1 ELSE v_n_games END);

      INSERT INTO public.bet_markets
          (market_type, title, week_id, game_number, subject_game_id, params, status, created_by_player_id)
        VALUES ('combo',
                array_to_string(v_member_names, ' + ') || ' ' || v_label
                  || ' — ' || CASE WHEN v_scope = 'game' THEN 'Game ' || v_game_number ELSE 'Night' END,
                p_week_id,
                CASE WHEN v_scope = 'game' THEN v_game_number ELSE NULL END,
                NULL,
                jsonb_build_object(
                  'family', 'combo',
                  'stat', v_stat,
                  'scope', v_scope,
                  'clock', v_clock,
                  'member_ids', to_jsonb(v_member_texts),
                  'member_names', to_jsonb(v_member_names),
                  'combo_key', v_combo_key),
                'open',
                v_player_id)
        RETURNING id INTO v_market_id;

      -- Combo distribution: members modeled independent, so per-game means
      -- and variances add (night scaling happens inside the pricer). total_pins
      -- maps to the members' score distributions.
      SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
        INTO v_mean, v_var
        FROM (SELECT DISTINCT m FROM unnest(v_members) m) mem
        CROSS JOIN LATERAL public.odds_engine_player_stat(
          mem.m, v_season_id,
          CASE WHEN v_stat = 'total_pins' THEN 'score' ELSE v_stat END) ps;

      v_cn := CASE WHEN v_scope = 'game' THEN 1 ELSE v_n_games END;
      v_spacing := CASE
        WHEN v_stat <> 'total_pins' THEN v_cfg.spacing_count
        WHEN v_scope = 'game' THEN v_cfg.spacing_score
        ELSE v_cfg.spacing_night_pins END;
      v_hi := CASE WHEN v_stat = 'total_pins'
                   THEN 220 * v_cn * array_length(v_members, 1) + 0.5
                   ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_cn, v_spacing, 0.5, v_hi, v_season_id);

      IF v_spec_line IS NULL THEN
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.key = 'over';
      ELSE
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.side = 'over' AND s.line = v_spec_line;
        IF v_over_id IS NULL THEN
          IF v_spec_quote IS NOT NULL THEN
            -- Chosen line off the fresh ladder: mint it on demand alongside.
            v_over_id := public.bet_mint_rung_internal(v_market_id, v_spec_line, v_spec_quote);
            SELECT s.line, s.odds INTO v_line, v_odds
              FROM public.bet_selections s WHERE s.id = v_over_id;
          ELSE
            RAISE EXCEPTION 'That line is not offered for this combo — pick a posted rung';
          END IF;
        END IF;
      END IF;

      v_n_created := v_n_created + 1;
      IF v_first_created IS NULL THEN
        v_first_created := jsonb_build_object(
          'stat', v_stat, 'scope', v_scope, 'game_number', v_game_number,
          'member_count', array_length(v_members, 1),
          'member_names', to_jsonb(v_member_names),
          'line', v_line, 'odds', v_odds);
      END IF;
    END IF;

    -- One ticket cannot carry the same combo twice (place_house_bet expects
    -- each leg on a distinct market; two identical specs dedup to one market).
    IF v_market_id = ANY (v_market_ids) THEN
      RAISE EXCEPTION 'The same combo appears twice on this ticket';
    END IF;
    v_market_ids := v_market_ids || v_market_id;
    v_over_ids := v_over_ids || v_over_id;
    v_combos_out := v_combos_out || jsonb_build_object(
      'market_id', v_market_id, 'line', v_line, 'odds', v_odds, 'deduped', v_deduped);
  END LOOP;

  -- Line-shaped parlay extras: regular picks riding the same ticket, minted
  -- through the same helper (must be OTHER markets — no self-referential legs).
  IF p_extra_picks IS NOT NULL THEN
    IF jsonb_typeof(p_extra_picks) <> 'array' THEN
      RAISE EXCEPTION 'extra_picks must be an array';
    END IF;
    FOR v_pick IN SELECT value FROM jsonb_array_elements(p_extra_picks) LOOP
      v_pick_market := (v_pick ->> 'market_id')::uuid;
      IF v_pick_market IS NULL THEN
        RAISE EXCEPTION 'Every pick needs a market_id';
      END IF;
      IF v_pick_market = ANY (v_market_ids) THEN
        RAISE EXCEPTION 'A combo cannot parlay with its own selections';
      END IF;
      v_extra_ids := v_extra_ids || public.bet_mint_rung_internal(
        v_pick_market, (v_pick ->> 'line')::numeric, (v_pick ->> 'quoted_odds')::numeric);
    END LOOP;
  END IF;

  -- Parlay extras must be OTHER markets' selections (no self-referential legs).
  IF p_extra_selection_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bet_selections s
    WHERE s.id = ANY (p_extra_selection_ids) AND s.market_id = ANY (v_market_ids)
  ) THEN
    RAISE EXCEPTION 'A combo cannot parlay with its own selections';
  END IF;

  -- Compose = bet: place_house_bet re-validates every leg (open market, same
  -- season/week, min stake, balance, anti-tank, item contracts) and writes the
  -- bet + legs + the bet_stake double entry. Any failure rolls the new
  -- market(s) and minted rung(s) back too.
  v_bet_id := public.place_house_bet(
    v_over_ids || v_extra_ids || COALESCE(p_extra_selection_ids, '{}'::uuid[]),
    p_stake, NULL,
    p_insurance_item_id, p_crutch_item_id, p_boost_item_id);

  -- Feed: at most ONE compose card per bet (activity_feed_unique_bet_event is
  -- (bet, event_type)) — published only when this ticket minted ≥1 new market;
  -- payload carries the first created combo + how many were created. Dedup-only
  -- tickets post nothing beyond place_house_bet's own priority events.
  IF v_n_created > 0 THEN
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_combo_composed',
      v_season_id, p_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.combo_composed',
      v_first_created || jsonb_build_object('stake', p_stake, 'combo_count', v_n_created),
      jsonb_build_object('bet_id', v_bet_id, 'market_ids', to_jsonb(v_market_ids)),
      NULL, now());
  END IF;

  RETURN jsonb_build_object('bet_id', v_bet_id, 'combos', v_combos_out);
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
    SELECT s2.key INTO v_counterparty_sel
      FROM public.bet_selections s1
      JOIN public.bet_selections s2
        ON s2.market_id = s1.market_id
       AND s2.id <> s1.id
       AND s2.line IS NOT DISTINCT FROM s1.line
       AND (s1.side IS NULL OR s2.side IS DISTINCT FROM s1.side)
      WHERE s1.market_id = p_prop_market_id AND s1.key = p_selection
      LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.create_auction(p_catalog_key text, p_description text, p_minimum_bid integer, p_opens_at timestamp with time zone, p_closes_at timestamp with time zone, p_quantity integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season  uuid;
  v_cat     public.item_catalog;
  v_id      uuid;
  v_opens   timestamptz;
BEGIN
  PERFORM public.assert_admin();
  v_season := public.current_season_id();

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Unknown catalog item: %', p_catalog_key;
  END IF;
  -- Storefront rule: retired items can't be newly auctioned (owned instances
  -- are unaffected — retirement never confiscates).
  IF NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Catalog item % is retired', p_catalog_key;
  END IF;

  v_opens := COALESCE(p_opens_at, now());
  IF p_closes_at IS NULL OR p_closes_at <= now() THEN
    RAISE EXCEPTION 'Close time must be in the future';
  END IF;
  IF p_closes_at <= v_opens THEN
    RAISE EXCEPTION 'Close time must be after open time';
  END IF;
  IF p_minimum_bid IS NULL OR p_minimum_bid <= 0 THEN
    RAISE EXCEPTION 'Minimum bid must be at least 1';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;

  INSERT INTO public.auctions (season_id, catalog_item_id, description, opens_at, closes_at, minimum_bid, quantity)
    VALUES (v_season, v_cat.id, p_description, v_opens, p_closes_at, p_minimum_bid, p_quantity)
    RETURNING id INTO v_id;

  -- "Opens now" creates open directly (same path as the sweep's open phase).
  IF v_opens <= now() THEN
    PERFORM public.open_auction_internal(v_id);
  END IF;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_catalog_item(p_key text, p_name text, p_description text, p_icon text, p_effect_type text, p_effect_params jsonb, p_activation_mode text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  PERFORM public.assert_admin();

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
    SELECT s2.key INTO v_counterparty_sel
      FROM public.bet_selections s1
      JOIN public.bet_selections s2
        ON s2.market_id = s1.market_id
       AND s2.id <> s1.id
       AND s2.line IS NOT DISTINCT FROM s1.line
       AND (s1.side IS NULL OR s2.side IS DISTINCT FROM s1.side)
      WHERE s1.market_id = p_prop_market_id AND s1.key = p_creator_selection
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
  v_escrow     int;
  v_bounty_id  uuid;
BEGIN
  v_sponsor_id := public.current_player_id();
  v_season_id  := public.current_season_id();

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

  IF public.pin_balance(v_sponsor_id, v_season_id) < v_escrow THEN
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
  PERFORM public.pin_ledger_double_entry(
    v_sponsor_id, v_season_id, p_week_id,
    -v_escrow, 'bounty_sponsor_stake', 'Bounty sponsor stake escrowed',
    NULL, NULL, v_bounty_id);

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
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.current_player_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.players WHERE user_id = (SELECT auth.uid());
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_season_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.custom_access_token(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.decrypt_bid_amount(p_enc bytea)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT extensions.pgp_sym_decrypt(p_enc, public.auction_bid_key())::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.encrypt_bid_amount(p_amount integer)
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT extensions.pgp_sym_encrypt(p_amount::text, public.auction_bid_key());
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

CREATE OR REPLACE FUNCTION public.enqueue_broadcast_for_activity_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rule  public.broadcast_event_rules;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.visibility <> 'public' OR NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule
    FROM public.broadcast_event_rules
   WHERE event_type = NEW.event_type AND enabled;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_title := left(btrim(public.render_broadcast_event_template(v_rule.title_template, NEW)), 120);
    v_body  := left(btrim(public.render_broadcast_event_template(v_rule.body_template, NEW)), 1000);
    -- Satisfy the broadcasts length CHECKs even if a template renders empty.
    v_title := COALESCE(NULLIF(v_title, ''), 'Market Moves');
    v_body  := COALESCE(NULLIF(v_body, ''), 'Something just happened in the Pinsino.');

    INSERT INTO public.broadcasts (category_id, title, body, target_player_ids, data, source, scheduled_for)
    VALUES (
      v_rule.category_id,
      v_title,
      v_body,
      NULL,
      -- event_type + activity_event_id are the audit thread back to the feed
      -- row (and what suppress_activity_event uses to cancel a pending push).
      (CASE WHEN v_rule.route_key IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('route', v_rule.route_key) END)
        || jsonb_build_object('event_type', NEW.event_type, 'activity_event_id', NEW.id),
      'event',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_broadcast_for_activity_event: event % (%) not pushed: %',
      NEW.id, NEW.event_type, SQLERRM;
  END;

  RETURN NEW;
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
  v_entry_number int;
  v_count        int;
  v_stake_id     uuid;
BEGIN
  v_hunter_id := public.current_player_id();

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

  IF public.pin_balance(v_hunter_id, v_bounty.season_id) < v_bounty.hunter_stake_amount THEN
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

  PERFORM public.pin_ledger_double_entry(
    v_hunter_id, v_bounty.season_id, v_bounty.week_id,
    -v_bounty.hunter_stake_amount, 'bounty_hunter_stake', 'Bounty hunter stake escrowed',
    NULL, NULL, p_bounty_post_id);

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
  v_bet       record;
  v_leg       record;
  v_odds      numeric;
  v_payout    integer;
  v_week_id   uuid;
  v_share     numeric;
  v_refund    integer;
  v_crutched  boolean;
  v_won_legs  integer;
  v_boost_pct numeric;
  v_bonus     integer;
  v_haunt_n   integer;
  v_profit    integer;
  v_haunt     record;
  v_idx       integer;
  v_cut       integer;
  v_haunters  jsonb;
BEGIN
  SELECT week_id INTO v_week_id FROM public.bet_markets WHERE id = p_market_id;

  FOR v_bet IN
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake, b.insurance_item_id, b.crutch_item_id, b.boost_item_id, b.boost_pct
    FROM public.bets b
    JOIN public.bet_legs       l ON l.bet_id = b.id
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id AND b.status = 'pending'
  LOOP
    v_crutched := false;

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

    -- Winner's Crutch: a parlay that misses by exactly one leg is salvaged —
    -- cancel the lone losing leg (→ 'crutched', a drop-out) so the bet pays on
    -- the survivors. Only fires when precisely one leg lost (2+ losses = a real
    -- loss the crutch can't fix).
    IF v_bet.crutch_item_id IS NOT NULL
       AND (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') = 1 THEN
      UPDATE public.bet_legs
         SET result = 'crutched'
       WHERE id = (SELECT id FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost' LIMIT 1);
      v_crutched := true;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger…
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

      -- …unless insured. Safety Ticket: House-funded stake refund of
      -- floor(stake × refund_share), read from the item's catalog params.
      -- Bet-linked AND week-stamped → captured/reversed by the archive engine
      -- exactly like every other bet movement. NOT-EXISTS guard makes
      -- re-settlement (force re-archive) idempotent. Lost branch ONLY: pushes
      -- refund normally below and the ticket stays spent; force-void pays only
      -- bet_refund (this function never runs for voids).
      IF v_bet.insurance_item_id IS NOT NULL THEN
        SELECT COALESCE((c.effect_params ->> 'refund_share')::numeric, 1.0) INTO v_share
          FROM public.player_inventory_items i
          JOIN public.item_catalog c ON c.id = i.catalog_item_id
         WHERE i.id = v_bet.insurance_item_id;

        v_refund := FLOOR(v_bet.stake * COALESCE(v_share, 1.0));

        IF v_refund > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger
           WHERE bet_id = v_bet.id AND type = 'bet_insurance_refund'
        ) THEN
          PERFORM public.pin_ledger_double_entry(
            v_bet.player_id, v_bet.season_id, v_week_id,
            v_refund, 'bet_insurance_refund', 'Safety Ticket refund', NULL, v_bet.id);
        END IF;
      END IF;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void', 'crutched')
    ) THEN
      -- All legs push/void/crutched → refund the stake (double-entry). A Crutch
      -- that removes the only loss but leaves no survivor lands here. Any haunts
      -- get nothing (no profit existed); their tickets stay spent.
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, v_week_id,
        v_bet.stake, 'bet_refund', 'Push refund', NULL, v_bet.id);

    ELSE
      -- Won: payout = floor(stake × product(won-leg odds)). Push/void/crutched
      -- legs drop out → the Crutch's "reduced odds" is exactly this recompute.
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

      SELECT count(*) INTO v_haunt_n FROM public.bet_haunts WHERE bet_id = v_bet.id;

      IF v_haunt_n > 0 THEN
        -- Haunted win: the owner keeps only their stake; the ghosts eat the profit.
        -- Owner stake-back stays on 'bet_payout' (identical accounting/tooling).
        PERFORM public.pin_ledger_double_entry(
          v_bet.player_id, v_bet.season_id, v_week_id,
          v_bet.stake, 'bet_payout', 'Bet won (haunted — stake returned)', NULL, v_bet.id);

        v_profit := v_payout - v_bet.stake;

        -- Split the profit across the N ghosts ordered by attached_at: each gets
        -- floor(profit/N); the earliest r = profit mod N get +1. Owner ends at
        -- EXACTLY stake; the books net to zero. Guard keeps re-settlement idempotent.
        IF v_profit > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger WHERE bet_id = v_bet.id AND type = 'bet_haunt_steal'
        ) THEN
          v_idx := 0;
          FOR v_haunt IN
            SELECT id, haunter_player_id
              FROM public.bet_haunts
             WHERE bet_id = v_bet.id
             ORDER BY attached_at, id
          LOOP
            v_cut := v_profit / v_haunt_n;                 -- integer floor (profit > 0)
            IF v_idx < (v_profit % v_haunt_n) THEN
              v_cut := v_cut + 1;                          -- remainder to the earliest
            END IF;
            v_idx := v_idx + 1;

            IF v_cut > 0 THEN
              PERFORM public.pin_ledger_double_entry(
                v_haunt.haunter_player_id, v_bet.season_id, v_week_id,
                v_cut, 'bet_haunt_steal', 'Ghost in the Slip — profit stolen', NULL, v_bet.id);
            END IF;
            UPDATE public.bet_haunts SET payout_amount = v_cut WHERE id = v_haunt.id;
          END LOOP;

          -- One aggregate reveal per haunted win. The haunters ride in the payload
          -- (a feed row has a single subject = the victim). Deduped per (bet,
          -- event_type) by activity_feed_unique_bet_event → no double-up.
          SELECT jsonb_agg(jsonb_build_object('name', p.name, 'cut', bh.payout_amount) ORDER BY bh.attached_at, bh.id)
            INTO v_haunters
            FROM public.bet_haunts bh
            JOIN public.players p ON p.id = bh.haunter_player_id
           WHERE bh.bet_id = v_bet.id;

          PERFORM public.publish_activity_event(
            'sportsbook', 'sportsbook_haunt_hit',
            v_bet.season_id, v_week_id, NULL, v_bet.player_id, NULL,
            v_bet.id, NULL,
            'sportsbook.haunt_hit',
            jsonb_build_object('payout', v_payout, 'stake', v_bet.stake, 'profit', v_profit,
                               'ghost_count', v_haunt_n, 'haunters', v_haunters),
            jsonb_build_object('bet_id', v_bet.id),
            NULL, now());
        END IF;
      ELSE
        -- Unhaunted win: full payout to the owner.
        PERFORM public.pin_ledger_double_entry(
          v_bet.player_id, v_bet.season_id, v_week_id,
          v_payout, 'bet_payout', 'Bet won', NULL, v_bet.id);
      END IF;

      -- Energy Drink: House-funded bonus on the win = floor(payout × boost_pct),
      -- applied to the TOTAL payout (stake + winnings), so boost_pct = 1.0 doubles
      -- the whole payout. Reads the pct snapshotted onto the bet at placement (its
      -- flavor's value, locked in) so the paid bonus equals what the slip showed.
      -- ALWAYS credits the OWNER — their own item, their reward — even when ghosts
      -- ate the base profit. Bet-linked + week-stamped; NOT-EXISTS guard idempotent.
      IF v_bet.boost_item_id IS NOT NULL THEN
        v_boost_pct := COALESCE(v_bet.boost_pct, 1.0);
        v_bonus := FLOOR(v_payout * v_boost_pct);

        IF v_bonus > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger
           WHERE bet_id = v_bet.id AND type = 'bet_odds_boost'
        ) THEN
          PERFORM public.pin_ledger_double_entry(
            v_bet.player_id, v_bet.season_id, v_week_id,
            v_bonus, 'bet_odds_boost', 'Energy Drink bonus', NULL, v_bet.id);

          -- A boost that actually paid out → news. Deduped per (bet, event_type)
          -- by activity_feed_unique_bet_event, so re-settlement never doubles up.
          PERFORM public.publish_activity_event(
            'sportsbook', 'sportsbook_boost_hit',
            v_bet.season_id, v_week_id, v_bet.player_id, NULL, NULL,
            v_bet.id, NULL,
            'sportsbook.boost_hit',
            jsonb_build_object('payout', v_payout, 'bonus', v_bonus),
            jsonb_build_object('bet_id', v_bet.id),
            NULL, now());
        END IF;
      END IF;

      -- The Crutch actually saved a payout → news. Deduped per (bet, event_type)
      -- by activity_feed_unique_bet_event, so re-settlement never doubles up.
      IF v_crutched THEN
        SELECT count(*) INTO v_won_legs FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won';
        PERFORM public.publish_activity_event(
          'sportsbook', 'sportsbook_crutch_save',
          v_bet.season_id, v_week_id, v_bet.player_id, NULL, NULL,
          v_bet.id, NULL,
          'sportsbook.crutch_save',
          jsonb_build_object('payout', v_payout, 'legs', v_won_legs),
          jsonb_build_object('bet_id', v_bet.id),
          NULL, now());
      END IF;
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

CREATE OR REPLACE FUNCTION public.grant_inventory_item(p_player_id uuid, p_catalog_key text, p_quantity integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cat    public.item_catalog;
  v_season uuid;
BEGIN
  PERFORM public.assert_admin();

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Unknown catalog item: %', p_catalog_key;
  END IF;
  IF NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Catalog item % is retired', p_catalog_key;
  END IF;

  v_season := public.current_season_id();

  INSERT INTO public.player_inventory_items (player_id, catalog_item_id, season_id, source)
    SELECT p_player_id, v_cat.id, v_season, 'admin_grant'
      FROM generate_series(1, p_quantity);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.haunt_bet(p_target_bet_id uuid, p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_bet       public.bets%ROWTYPE;
  v_haunt_id  uuid;
BEGIN
  v_player_id := public.current_player_id();

  SELECT * INTO v_bet FROM public.bets WHERE id = p_target_bet_id;
  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'You can only haunt a pending bet';
  END IF;
  IF v_bet.player_id = v_player_id THEN
    RAISE EXCEPTION 'You cannot haunt your own bet';
  END IF;

  -- One haunt per haunter per bet (nice message before the consume; the UNIQUE
  -- constraint is the structural backstop).
  IF EXISTS (
    SELECT 1 FROM public.bet_haunts
     WHERE bet_id = p_target_bet_id AND haunter_player_id = v_player_id
  ) THEN
    RAISE EXCEPTION 'You have already haunted this bet';
  END IF;

  -- Validate the catalog contract before spending the item.
  IF NOT EXISTS (
    SELECT 1
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_item_id
       AND c.effect_type = 'haunt'
       AND c.activation_mode = 'attach_to_foreign_bet'
  ) THEN
    RAISE EXCEPTION 'That item is not a Ghost in the Slip';
  END IF;

  -- Consume the atomic ticket in one guarded UPDATE (owner + unconsumed + the
  -- bet's season — rowcount 0 means one of those failed). Spent win or lose.
  UPDATE public.player_inventory_items
     SET consumed_at = now()
   WHERE id = p_item_id
     AND player_id = v_player_id
     AND season_id = v_bet.season_id
     AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ghost in the Slip is not usable (already spent, wrong season, or not yours)';
  END IF;

  INSERT INTO public.bet_haunts (bet_id, haunter_player_id, inventory_item_id, season_id, week_id)
    VALUES (p_target_bet_id, v_player_id, p_item_id, v_bet.season_id, v_bet.week_id)
    RETURNING id INTO v_haunt_id;

  RETURN v_haunt_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.invoke_broadcast_sender()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Materialize due recurring slots first; a failure here can never block
  -- normal broadcast sending.
  BEGIN
    PERFORM public.materialize_due_recurring_broadcasts();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'invoke_broadcast_sender: recurring materialization failed: %', SQLERRM;
  END;

  -- Anything to do? Due pending sends, stale 'sending' reclaims, or receipts
  -- old enough to resolve (the Edge Function owns the exact cutoffs; these
  -- probes just avoid pointless invokes).
  IF NOT EXISTS (
       SELECT 1 FROM public.broadcasts
        WHERE (status = 'pending' AND scheduled_for <= now())
           OR (status = 'sending' AND claimed_at < now() - interval '10 minutes')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.broadcast_push_tickets
        WHERE status = 'pending_receipt' AND created_at < now() - interval '15 minutes'
     )
  THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'invoke_broadcast_sender: vault secrets project_url / service_role_key missing — scheduled broadcasts will not send';
    RETURN;
  END IF;

  -- Fire-and-forget (pg_net is async): the cron transaction never blocks on
  -- the send. Failures land in net._http_response.
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-broadcasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{"sweep":true}'::jsonb,
    timeout_milliseconds := 10000
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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

CREATE OR REPLACE FUNCTION public.issue_pin_bonus(p_player_ids uuid[], p_amount integer, p_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season uuid;
  v_player uuid;
BEGIN
  PERFORM public.assert_admin();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Bonus amount must be a positive number';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'Bonus label is required';
  END IF;
  IF p_player_ids IS NULL OR array_length(p_player_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one recipient is required';
  END IF;

  -- Current playing season (the getCurrent() rule): active, out of registration.
  SELECT id INTO v_season
  FROM public.seasons
  WHERE is_active AND NOT registration_open
  ORDER BY number DESC
  LIMIT 1;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'No active season to credit the bonus into';
  END IF;

  FOREACH v_player IN ARRAY p_player_ids LOOP
    -- House-funded double entry. p_house_description = p_label so both sides of
    -- the ledger read identically (matches the champion-bonus convention).
    PERFORM public.pin_ledger_double_entry(
      v_player, v_season, NULL, p_amount, 'bonus', btrim(p_label), btrim(p_label));

    -- Public Market Moves announcement (subject = recipient; no actor/FK).
    PERFORM public.publish_activity_event(
      'admin', 'admin_bonus_issued',
      v_season, NULL, NULL, v_player, NULL,
      NULL, NULL,
      'admin.bonus_issued',
      jsonb_build_object('amount', p_amount, 'label', btrim(p_label)),
      '{}'::jsonb,
      'public', now());
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.lanetalk_game_stats(p_payload jsonb)
 RETURNS TABLE(strikes integer, spares integer, clean_pct numeric, first_ball_avg numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_strike')::boolean, false))::integer AS strikes,
    COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_spare')::boolean,  false))::integer AS spares,
    CASE WHEN COUNT(*) > 0 THEN
      (COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_strike')::boolean, false)
                           OR COALESCE((f.value ->> 'is_spare')::boolean,  false)))::numeric
        / COUNT(*) * 100
    END AS clean_pct,
    CASE WHEN COUNT(*) > 0 THEN
      SUM(COALESCE((f.value -> 'throws' -> 0 ->> 'pins')::numeric, 0)) / COUNT(*)
    END AS first_ball_avg
  FROM jsonb_array_elements(COALESCE(p_payload -> 'frames', '[]'::jsonb)) AS f(value);
$function$
;

CREATE OR REPLACE FUNCTION public.lanetalk_seed_lines(p_player_id uuid)
 RETURNS TABLE(strikes_line numeric, spares_line numeric, strikes_per_game numeric, spares_per_game numeric, clean_frames_per_game numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    LEAST(9.5, GREATEST(0.5, floor(avg(i.strikes)) + 0.5)) AS strikes_line,
    LEAST(9.5, GREATEST(0.5, floor(avg(i.spares)) + 0.5))  AS spares_line,
    avg(i.strikes)                                         AS strikes_per_game,
    avg(i.spares)                                          AS spares_per_game,
    avg(i.strikes + i.spares)                              AS clean_frames_per_game
  FROM public.lanetalk_game_imports i
  WHERE i.player_id = p_player_id
    AND i.classification = 'official'
    AND i.frames > 0
  HAVING count(*) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.link_auth_user_to_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.market_price_line(p_market_id uuid, p_line numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt       public.bet_markets;
  v_seed_line numeric;
  v_seed_odds numeric;
  v_posted    numeric;
  v_line      numeric;
  v_cfg       public.odds_engine_config;
  v_d         record;
BEGIN
  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_mkt.market_type NOT IN ('over_under', 'prop', 'combo') THEN
    RAISE EXCEPTION 'Market type % is not priceable', v_mkt.market_type;
  END IF;
  -- Closed markets still preview (the client gates staging on status);
  -- settled/void ones have nothing left to quote.
  IF v_mkt.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market is no longer quotable';
  END IF;

  SELECT s.line, s.odds INTO v_seed_line, v_seed_odds
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.key = 'over';
  IF v_seed_line IS NULL THEN
    RAISE EXCEPTION 'Market has no seed selection';
  END IF;

  v_line := COALESCE(p_line, v_seed_line);
  IF v_line <> floor(v_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', v_line;
  END IF;

  SELECT s.odds INTO v_posted
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;

  SELECT * INTO v_d FROM public.odds_engine_market_distribution(p_market_id);
  v_cfg := public.odds_engine_get_config(v_d.season_id);

  RETURN public.odds_engine_quote_internal(
    v_line, v_seed_line, v_seed_odds, v_posted,
    v_cfg.is_enabled, v_d.mean, v_d.variance, v_d.n_games,
    v_d.range_lo, v_d.range_hi,
    COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
    COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.materialize_due_recurring_broadcasts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s           record;
  v_local_now timestamp;   -- wall clock in the slot's timezone
  v_occ_local timestamp;   -- this week's occurrence, local wall clock
  v_due       timestamptz; -- same instant, absolute
  v_days_back int;
  v_week_id   uuid;
  v_targets   uuid[];
  v_data      jsonb;
BEGIN
  FOR s IN SELECT * FROM public.recurring_broadcast_schedules WHERE enabled LOOP
    BEGIN
      -- Most recent occurrence of (day_of_week, send_time) at or before now,
      -- computed in local wall-clock space (DST-safe), converted once.
      v_local_now := now() AT TIME ZONE s.timezone;
      v_days_back := ((EXTRACT(DOW FROM v_local_now)::int - s.day_of_week) + 7) % 7;
      v_occ_local := (v_local_now::date - v_days_back) + s.send_time;
      IF v_occ_local > v_local_now THEN
        v_occ_local := v_occ_local - interval '7 days';
      END IF;
      v_due := v_occ_local AT TIME ZONE s.timezone;

      -- Each occurrence fires at most once (last_fired_at only moves forward).
      IF v_due <= s.last_fired_at THEN
        CONTINUE;
      END IF;

      -- Consume the occurrence before any skip: a skipped one never fires late.
      UPDATE public.recurring_broadcast_schedules
         SET last_fired_at = now()
       WHERE id = s.id;

      -- Lateness cap: downtime must never cause a middle-of-the-night nag.
      IF now() - v_due > interval '2 hours' THEN
        CONTINUE;
      END IF;

      v_data := jsonb_build_object('recurring_schedule_id', s.id);
      IF s.route_key IS NOT NULL THEN
        v_data := v_data || jsonb_build_object('route', s.route_key);
      END IF;

      IF s.audience = 'rsvp_non_responders' THEN
        -- Current week: latest unarchived week of the active, registration-closed
        -- season (same rule as weeks.getCurrent() / submit_own_rsvp).
        SELECT w.id INTO v_week_id
          FROM public.weeks w
          JOIN public.seasons se ON se.id = w.season_id
         WHERE se.is_active AND NOT se.registration_open AND NOT w.is_archived
         ORDER BY w.week_number DESC
         LIMIT 1;
        IF v_week_id IS NULL THEN
          CONTINUE;  -- offseason / registration / unarchive window
        END IF;

        SELECT array_agg(p.id) INTO v_targets
          FROM public.players p
         WHERE p.is_active
           AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
              WHERE r.week_id = v_week_id AND r.player_id = p.id
           );
        IF v_targets IS NULL THEN
          CONTINUE;  -- everyone has responded
        END IF;

        v_data := v_data || jsonb_build_object('week_id', v_week_id);
      ELSIF s.audience = 'everyone' THEN
        v_targets := NULL;  -- whole category (broadcast_recipients semantics)
      ELSE
        RAISE WARNING 'materialize_due_recurring_broadcasts: slot % has unknown audience %', s.id, s.audience;
        CONTINUE;
      END IF;

      INSERT INTO public.broadcasts
        (category_id, title, body, target_player_ids, data, source, scheduled_for)
      VALUES
        (s.category_id, s.title, s.body, v_targets, v_data, 'recurring', now());
    EXCEPTION WHEN OTHERS THEN
      -- Per-slot isolation (also contains an invalid timezone value).
      RAISE WARNING 'materialize_due_recurring_broadcasts: slot % skipped: %', s.id, SQLERRM;
    END;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.my_bid_amount(p_auction_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.decrypt_bid_amount(b.bid_amount_enc)
    FROM public.auction_bids b
   WHERE b.auction_id = p_auction_id
     AND b.player_id = public.current_player_id()
     AND b.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_build_ladder(p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS TABLE(key text, label text, odds numeric, line numeric, sort_order integer, side text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg   public.odds_engine_config;
  v_line  numeric;
  v_over  numeric;
  v_under numeric;
  j       integer;
BEGIN
  v_cfg := public.odds_engine_get_config(p_season_id);

  IF NOT v_cfg.is_enabled OR p_mean IS NULL OR p_variance IS NULL THEN
    RETURN QUERY VALUES
      ('over',  'Over',  2.000::numeric, p_seed_line, 0, 'over'),
      ('under', 'Under', 2.000::numeric, p_seed_line, 1, 'under');
    RETURN;
  END IF;

  FOR j IN -v_cfg.rungs_per_side .. v_cfg.rungs_per_side LOOP
    v_line := p_seed_line + j * p_spacing;
    IF v_line < p_range_lo OR v_line > p_range_hi THEN
      CONTINUE;
    END IF;

    SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
      FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, v_line,
                                         v_cfg.odds_min, v_cfg.odds_max, j = 0) pp;
    IF v_over IS NULL OR (j <> 0 AND v_over < v_cfg.odds_min) THEN
      CONTINUE;  -- below the offer floor (odds_min): not posted; the seed
                 -- anchor always posts.
    END IF;

    RETURN QUERY VALUES
      (CASE WHEN j = 0 THEN 'over' ELSE 'over:' || v_line END,
       'Over', v_over, v_line, (j + v_cfg.rungs_per_side) * 2, 'over'),
      (CASE WHEN j = 0 THEN 'under' ELSE 'under:' || v_line END,
       'Under', v_under, v_line, (j + v_cfg.rungs_per_side) * 2 + 1, 'under');
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_bvn_cdf(p_h double precision, p_k double precision, p_rho double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_r   double precision := LEAST(0.95, GREATEST(-0.95, p_rho));
  v_ph  double precision := public.odds_engine_norm_cdf(p_h);
  v_pk  double precision := public.odds_engine_norm_cdf(p_k);
  v_sum double precision := 0;
  v_t   double precision;
  v_f   double precision;
  v_w   double precision;
  n     integer := 32;
  i     integer;
BEGIN
  IF v_r <> 0 THEN
    FOR i IN 0 .. n LOOP
      v_t := v_r * i / n;
      v_f := exp(-(p_h * p_h - 2 * v_t * p_h * p_k + p_k * p_k) / (2 * (1 - v_t * v_t)))
             / sqrt(1 - v_t * v_t);
      v_w := CASE WHEN i = 0 OR i = n THEN 1 WHEN i % 2 = 1 THEN 4 ELSE 2 END;
      v_sum := v_sum + v_w * v_f;
    END LOOP;
    v_sum := v_sum * v_r / (3 * n) / (2 * pi());
  END IF;
  RETURN GREATEST(GREATEST(0, v_ph + v_pk - 1),
                  LEAST(LEAST(v_ph, v_pk), v_ph * v_pk + v_sum));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_get_config(p_season_id uuid)
 RETURNS odds_engine_config
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg public.odds_engine_config;
BEGIN
  -- Season override wins over the global row; a missing table row degrades to
  -- typed defaults (engine enabled) so fixture seasons never crash pricing.
  SELECT * INTO v_cfg
    FROM public.odds_engine_config
    WHERE season_id = p_season_id OR season_id IS NULL
    ORDER BY season_id NULLS LAST
    LIMIT 1;
  IF v_cfg.id IS NULL THEN
    v_cfg.is_enabled           := true;
    v_cfg.half_life_games      := 6;
    v_cfg.prior_weight_games   := 6;
    v_cfg.variance_floor_score := 225;
    v_cfg.variance_floor_count := 0.75;
    v_cfg.odds_min             := 1.20;
    v_cfg.odds_max             := 8.00;
    v_cfg.rungs_per_side       := 3;
    v_cfg.spacing_score        := 10;
    v_cfg.spacing_night_pins   := 20;
    v_cfg.spacing_count        := 1.0;
    v_cfg.quote_tolerance      := 0.10;
  END IF;
  RETURN v_cfg;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_league_prior(p_season_id uuid, p_stat text, OUT mean numeric, OUT variance numeric)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_stat = 'score' THEN
    SELECT AVG(s.score), var_pop(s.score) INTO mean, variance
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = p_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score > 0;

    IF mean IS NULL THEN
      SELECT AVG(s.score), var_pop(s.score) INTO mean, variance
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;
    END IF;

    mean     := COALESCE(mean, 130);
    variance := COALESCE(NULLIF(variance, 0), 225);

  ELSIF p_stat IN ('strikes', 'spares', 'clean_frames') THEN
    SELECT AVG(v), var_pop(v) INTO mean, variance
    FROM (
      SELECT CASE p_stat
               WHEN 'strikes' THEN i.strikes
               WHEN 'spares'  THEN i.spares
               ELSE i.strikes + i.spares
             END AS v
      FROM public.lanetalk_game_imports i
      WHERE i.classification = 'official' AND i.frames > 0
    ) g;

    mean     := COALESCE(mean, CASE p_stat WHEN 'clean_frames' THEN 4 ELSE 2 END);
    variance := COALESCE(NULLIF(variance, 0), 2);

  ELSE
    RAISE EXCEPTION 'Unknown odds engine stat %', p_stat;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_market_distribution(p_market_id uuid, OUT mean numeric, OUT variance numeric, OUT n_games integer, OUT range_lo numeric, OUT range_hi numeric, OUT season_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt        public.bet_markets;
  v_week_games integer;
  v_stat       text;
  v_scope      text;
  v_members    uuid[];
BEGIN
  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  SELECT w.season_id INTO season_id FROM public.weeks w WHERE w.id = v_mkt.week_id;

  -- Week schedule size (night scopes): the games table once it exists, else
  -- the pre-teams default of 2 — the same policy as every sync generator.
  SELECT COUNT(DISTINCT g.game_number) INTO v_week_games
    FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = v_mkt.week_id;
  IF v_week_games IS NULL OR v_week_games = 0 THEN
    v_week_games := 2;
  END IF;

  IF v_mkt.market_type = 'over_under' THEN
    SELECT ps.mean, ps.variance INTO mean, variance
      FROM public.odds_engine_player_stat(v_mkt.subject_player_id, season_id, 'score') ps;
    IF v_mkt.game_number IS NOT NULL THEN
      n_games := 1;            range_lo := 0.5; range_hi := 220.5;
    ELSE
      n_games := v_week_games; range_lo := 0.5; range_hi := 220 * v_week_games + 0.5;
    END IF;

  ELSIF v_mkt.market_type = 'prop' THEN
    v_stat := v_mkt.params ->> 'stat';
    IF v_stat IS NULL OR v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
      RAISE EXCEPTION 'Market stat % is not priceable', COALESCE(v_stat, '(null)');
    END IF;
    SELECT ps.mean, ps.variance INTO mean, variance
      FROM public.odds_engine_player_stat(v_mkt.subject_player_id, season_id, v_stat) ps;
    IF v_mkt.game_number IS NOT NULL THEN
      n_games := 1;            range_lo := 0.5; range_hi := 9.5;
    ELSE
      n_games := v_week_games; range_lo := 0.5; range_hi := 10 * v_week_games - 0.5;
    END IF;

  ELSIF v_mkt.market_type = 'combo' THEN
    v_stat := v_mkt.params ->> 'stat';
    v_scope := v_mkt.params ->> 'scope';
    SELECT array_agg((m.value)::uuid) INTO v_members
      FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') m;
    IF v_members IS NULL OR v_stat IS NULL
       OR v_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
      RAISE EXCEPTION 'Combo market % has no priceable params', p_market_id;
    END IF;
    -- Members modeled independent: per-game means and variances add.
    SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
      INTO mean, variance
      FROM (SELECT DISTINCT m FROM unnest(v_members) m) mem
      CROSS JOIN LATERAL public.odds_engine_player_stat(
        mem.m, season_id,
        CASE WHEN v_stat = 'total_pins' THEN 'score' ELSE v_stat END) ps;
    n_games := CASE WHEN v_scope = 'game' THEN 1 ELSE v_week_games END;
    range_lo := 0.5;
    range_hi := CASE WHEN v_stat = 'total_pins'
                     THEN 220 * n_games * array_length(v_members, 1) + 0.5
                     ELSE 10 * n_games * array_length(v_members, 1) - 0.5 END;

  ELSE
    RAISE EXCEPTION 'Market type % is not priceable', v_mkt.market_type;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_mint_ladder(p_market_id uuid, p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    SELECT p_market_id, bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
    FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                         p_spacing, p_range_lo, p_range_hi, p_season_id) bl;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_norm_cdf(z double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN z >= 0 THEN 0.5 * (1.0 + e.erf) ELSE 0.5 * (1.0 - e.erf) END
  FROM (
    SELECT 1.0 - (((((1.061405429 * t.t - 1.453152027) * t.t + 1.421413741) * t.t
                    - 0.284496736) * t.t + 0.254829592) * t.t) * exp(-t.x * t.x) AS erf
    FROM (
      SELECT c.x, 1.0 / (1.0 + 0.3275911 * c.x) AS t
      FROM (SELECT abs(z) / sqrt(2.0) AS x) c
    ) t
  ) e;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_norm_ppf(p double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  q double precision;
  r double precision;
BEGIN
  IF p <= 0 OR p >= 1 THEN
    RAISE EXCEPTION 'norm_ppf requires p in (0, 1), got %', p;
  END IF;

  IF p < 0.02425 THEN
    q := sqrt(-2 * ln(p));
    RETURN (((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q
               - 2.400758277161838e+00) * q - 2.549732539343734e+00) * q
               + 4.374664141464968e+00) * q + 2.938163982698783e+00)
         / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q
               + 2.445134137142996e+00) * q + 3.754408661907416e+00) * q + 1.0);
  ELSIF p > 1 - 0.02425 THEN
    q := sqrt(-2 * ln(1 - p));
    RETURN -((((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q
               - 2.400758277161838e+00) * q - 2.549732539343734e+00) * q
               + 4.374664141464968e+00) * q + 2.938163982698783e+00)
         / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q
               + 2.445134137142996e+00) * q + 3.754408661907416e+00) * q + 1.0));
  ELSE
    q := p - 0.5;
    r := q * q;
    RETURN (((((-3.969683028665376e+01 * r + 2.209460984245205e+02) * r
               - 2.759285104469687e+02) * r + 1.383577518672690e+02) * r
               - 3.066479806614716e+01) * r + 2.506628277459239e+00) * q
         / (((((-5.447609879822406e+01 * r + 1.615858368580409e+02) * r
               - 1.556989798598866e+02) * r + 6.680131188771972e+01) * r
               - 1.328068155288572e+01) * r + 1.0);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_parlay_factors_internal(p_legs jsonb, p_season_id uuid)
 RETURNS numeric[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n       integer := COALESCE(jsonb_array_length(p_legs), 0);
  v_parent  integer[];
  v_roots   integer[] := '{}';
  v_factors numeric[];
  v_members integer[];
  v_la jsonb; v_lb jsonb;
  a integer; b integer; ra integer; rb integer; v_root integer;
  v_pl text;
  v_h_a double precision; v_h_b double precision;
  v_s_a integer; v_s_b integer;
  v_sg_a double precision; v_sg_b double precision;
  v_p_a double precision; v_p_b double precision;
  v_q double precision;
  v_cov double precision; v_games integer;
  v_sig_pa double precision; v_sig_pb double precision;
  v_rho double precision;
  v_pp double precision;
  v_f numeric;
BEGIN
  IF v_n < 2 THEN RETURN NULL; END IF;
  v_parent  := ARRAY(SELECT generate_series(1, v_n));
  v_factors := array_fill(1.0::numeric, ARRAY[v_n]);

  FOR a IN 1 .. v_n LOOP
    FOR b IN a + 1 .. v_n LOOP
      v_la := p_legs -> (a - 1);
      v_lb := p_legs -> (b - 1);
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_la -> 'subjects') sa(x)
                 WHERE sa.x IN (SELECT sb.y FROM jsonb_array_elements_text(v_lb -> 'subjects') sb(y)))
         AND ((v_la ->> 'game_number') IS NULL OR (v_lb ->> 'game_number') IS NULL
              OR (v_la ->> 'game_number') = (v_lb ->> 'game_number')) THEN
        ra := a; WHILE v_parent[ra] <> ra LOOP ra := v_parent[ra]; END LOOP;
        rb := b; WHILE v_parent[rb] <> rb LOOP rb := v_parent[rb]; END LOOP;
        IF ra <> rb THEN v_parent[rb] := ra; END IF;
      END IF;
    END LOOP;
  END LOOP;

  FOR a IN 1 .. v_n LOOP
    ra := a; WHILE v_parent[ra] <> ra LOOP ra := v_parent[ra]; END LOOP;
    v_roots := v_roots || ra;
  END LOOP;

  FOR v_root IN SELECT DISTINCT t.r FROM unnest(v_roots) AS t(r) LOOP
    v_members := ARRAY(SELECT i FROM generate_subscripts(v_roots, 1) i WHERE v_roots[i] = v_root);
    IF array_length(v_members, 1) = 1 THEN CONTINUE; END IF;
    IF array_length(v_members, 1) > 2 THEN
      v_pl := p_legs -> (v_members[1] - 1) -> 'subjects' ->> 0;
      RAISE EXCEPTION 'CORRELATED_LEGS|%', COALESCE(v_pl, '');
    END IF;

    a := v_members[1];
    b := v_members[2];
    v_la := p_legs -> (a - 1);
    v_lb := p_legs -> (b - 1);
    v_sg_a := (v_la ->> 'sigma')::double precision;
    v_sg_b := (v_lb ->> 'sigma')::double precision;
    IF v_sg_a IS NULL OR v_sg_b IS NULL OR v_sg_a <= 0 OR v_sg_b <= 0 THEN CONTINUE; END IF;

    -- Event as a lower-orthant: over X≥ℓ ⇔ (−Z) ≤ −z (s = −1), under ⇔ Z ≤ z.
    v_s_a := CASE WHEN v_la ->> 'side' = 'under' THEN 1 ELSE -1 END;
    v_s_b := CASE WHEN v_lb ->> 'side' = 'under' THEN 1 ELSE -1 END;

    -- Thresholds are QUOTE-implied (p̂ = 1/quoted, ẑ = Φ⁻¹(p̂)) so the joint
    -- price stays consistent with the odds the ticket multiplies; the model's
    -- (line − mu)/σ threshold is the fallback for a missing/degenerate quote.
    v_q := (v_la ->> 'quoted')::double precision;
    IF v_q IS NOT NULL AND v_q > 1 THEN
      v_p_a := LEAST(1 - 1e-9, GREATEST(1e-9, 1 / v_q));
      v_h_a := public.odds_engine_norm_ppf(v_p_a);
    ELSE
      v_h_a := v_s_a * (((v_la ->> 'line')::double precision - (v_la ->> 'mu')::double precision) / v_sg_a);
      v_p_a := public.odds_engine_norm_cdf(v_h_a);
    END IF;
    v_q := (v_lb ->> 'quoted')::double precision;
    IF v_q IS NOT NULL AND v_q > 1 THEN
      v_p_b := LEAST(1 - 1e-9, GREATEST(1e-9, 1 / v_q));
      v_h_b := public.odds_engine_norm_ppf(v_p_b);
    ELSE
      v_h_b := v_s_b * (((v_lb ->> 'line')::double precision - (v_lb ->> 'mu')::double precision) / v_sg_b);
      v_p_b := public.odds_engine_norm_cdf(v_h_b);
    END IF;

    -- Shared cells: overlapping scope means 1 shared game unless both night.
    v_games := CASE WHEN (v_la ->> 'game_number') IS NULL AND (v_lb ->> 'game_number') IS NULL
                    THEN LEAST(GREATEST((v_la ->> 'n_games')::integer, 1),
                               GREATEST((v_lb ->> 'n_games')::integer, 1))
                    ELSE 1 END;
    v_cov := 0;
    FOR v_pl IN SELECT sa.x FROM jsonb_array_elements_text(v_la -> 'subjects') sa(x)
                WHERE sa.x IN (SELECT sb.y FROM jsonb_array_elements_text(v_lb -> 'subjects') sb(y))
    LOOP
      SELECT sqrt(GREATEST(ps.variance, 0)) INTO v_sig_pa
        FROM public.odds_engine_player_stat(v_pl::uuid, p_season_id, v_la ->> 'stat') ps;
      SELECT sqrt(GREATEST(ps.variance, 0)) INTO v_sig_pb
        FROM public.odds_engine_player_stat(v_pl::uuid, p_season_id, v_lb ->> 'stat') ps;
      v_cov := v_cov + v_games
               * public.odds_engine_stat_rho(v_la ->> 'stat', v_lb ->> 'stat')::double precision
               * COALESCE(v_sig_pa, 0) * COALESCE(v_sig_pb, 0);
    END LOOP;

    v_rho := GREATEST(-0.95, LEAST(0.95, v_cov / (v_sg_a * v_sg_b)));
    v_rho := v_rho * v_s_a * v_s_b;

    v_pp := GREATEST(public.odds_engine_bvn_cdf(v_h_a, v_h_b, v_rho), 1e-12);
    v_f  := (v_p_a * v_p_b / v_pp)::numeric;
    v_factors[a] := sqrt(v_f);
    v_factors[b] := v_factors[a];
  END LOOP;

  RETURN v_factors;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_parlay_market_factors(p_market_ids uuid[], p_lines numeric[], p_sides text[], p_odds numeric[])
 RETURNS numeric[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer := COALESCE(array_length(p_market_ids, 1), 0);
  v_season uuid;
  v_cfg public.odds_engine_config;
  v_legs jsonb := '[]'::jsonb;
  v_m record;
  v_d record;
  v_stat text;
  v_subjects jsonb;
  i integer;
BEGIN
  IF v_n < 2 THEN RETURN NULL; END IF;
  SELECT w.season_id INTO v_season
    FROM public.bet_markets m JOIN public.weeks w ON w.id = m.week_id
    WHERE m.id = p_market_ids[1];
  v_cfg := public.odds_engine_get_config(v_season);
  IF NOT v_cfg.is_enabled THEN RETURN NULL; END IF;

  FOR i IN 1 .. v_n LOOP
    SELECT m.market_type, m.subject_player_id, m.game_number, m.params INTO v_m
      FROM public.bet_markets m WHERE m.id = p_market_ids[i];
    v_stat := NULL; v_subjects := '[]'::jsonb;
    IF v_m.market_type = 'over_under' AND v_m.subject_player_id IS NOT NULL THEN
      v_stat := 'score';
      v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'prop' AND v_m.subject_player_id IS NOT NULL
          AND (v_m.params ->> 'stat') IN ('strikes', 'spares', 'clean_frames') THEN
      v_stat := v_m.params ->> 'stat';
      v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'combo'
          AND (v_m.params ->> 'stat') IN ('total_pins', 'strikes', 'spares', 'clean_frames') THEN
      v_stat := CASE WHEN v_m.params ->> 'stat' = 'total_pins' THEN 'score' ELSE v_m.params ->> 'stat' END;
      v_subjects := COALESCE(v_m.params -> 'member_ids', '[]'::jsonb);
    END IF;

    IF v_stat IS NOT NULL AND p_lines[i] IS NOT NULL THEN
      SELECT d.mean, d.variance, d.n_games INTO v_d
        FROM public.odds_engine_market_distribution(p_market_ids[i]) d;
      IF v_d.mean IS NOT NULL AND v_d.variance IS NOT NULL AND v_d.variance > 0 THEN
        v_legs := v_legs || jsonb_build_array(jsonb_build_object(
          'subjects', v_subjects, 'stat', v_stat,
          'game_number', v_m.game_number, 'n_games', v_d.n_games,
          'mu', v_d.mean * GREATEST(v_d.n_games, 1),
          'sigma', sqrt(v_d.variance * GREATEST(v_d.n_games, 1)),
          'line', p_lines[i], 'side', COALESCE(p_sides[i], 'over'),
          'quoted', p_odds[i]));
        CONTINUE;
      END IF;
    END IF;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'subjects', '[]'::jsonb, 'stat', 'none', 'game_number', v_m.game_number,
      'n_games', 1, 'mu', 0, 'sigma', 0, 'line', 0, 'side', 'over'));
  END LOOP;

  RETURN public.odds_engine_parlay_factors_internal(v_legs, v_season);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_player_stat(p_player_id uuid, p_season_id uuid, p_stat text, OUT mean numeric, OUT variance numeric, OUT w_total numeric)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg    public.odds_engine_config;
  v_mean_w numeric;
  v_var_w  numeric;
  v_floor  numeric;
  v_pm     numeric;
  v_pv     numeric;
BEGIN
  v_cfg := public.odds_engine_get_config(p_season_id);
  v_floor := CASE WHEN p_stat = 'score' THEN v_cfg.variance_floor_score ELSE v_cfg.variance_floor_count END;

  IF p_stat = 'score' THEN
    -- Archived bowled scores, lifetime (skill persists across seasonal pin
    -- resets), newest night first.
    WITH ordered AS (
      SELECT s.score::numeric AS v,
             row_number() OVER (ORDER BY w.bowled_at DESC NULLS LAST, w.created_at DESC, s.created_at DESC) - 1 AS rk
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id = p_player_id AND s.score > 0
    ), weighted AS (
      SELECT v, power(0.5, rk / v_cfg.half_life_games) AS wt FROM ordered
    ), agg AS (
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m FROM weighted
    )
    SELECT a.w, a.m,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_var_w
    FROM agg a;

  ELSIF p_stat IN ('strikes', 'spares', 'clean_frames') THEN
    WITH ordered AS (
      SELECT (CASE p_stat
                WHEN 'strikes' THEN i.strikes
                WHEN 'spares'  THEN i.spares
                ELSE i.strikes + i.spares
              END)::numeric AS v,
             row_number() OVER (ORDER BY i.played_at DESC NULLS LAST, i.created_at DESC) - 1 AS rk
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = p_player_id AND i.classification = 'official' AND i.frames > 0
    ), weighted AS (
      SELECT v, power(0.5, rk / v_cfg.half_life_games) AS wt FROM ordered
    ), agg AS (
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m FROM weighted
    )
    SELECT a.w, a.m,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_var_w
    FROM agg a;

  ELSE
    RAISE EXCEPTION 'Unknown odds engine stat %', p_stat;
  END IF;

  w_total := COALESCE(w_total, 0);
  SELECT lp.mean, lp.variance INTO v_pm, v_pv FROM public.odds_engine_league_prior(p_season_id, p_stat) lp;

  IF w_total = 0 THEN
    mean     := v_pm;
    variance := GREATEST(v_floor, v_pv);
  ELSE
    mean     := (w_total * v_mean_w + v_cfg.prior_weight_games * v_pm) / (w_total + v_cfg.prior_weight_games);
    variance := GREATEST(v_floor,
                  (w_total * COALESCE(v_var_w, 0) + v_cfg.prior_weight_games * v_pv)
                  / (w_total + v_cfg.prior_weight_games));
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_price_pair(p_mean numeric, p_variance numeric, p_n_games integer, p_line numeric, p_odds_min numeric, p_odds_max numeric, p_force boolean, OUT over_odds numeric, OUT under_odds numeric)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_mean  numeric := p_mean * GREATEST(p_n_games, 1);
  v_var   numeric := p_variance * GREATEST(p_n_games, 1);
  v_p     double precision;
  v_over  numeric;
  v_under numeric;
BEGIN
  v_p := 1.0 - public.odds_engine_norm_cdf(((p_line - v_mean) / sqrt(v_var))::double precision);
  v_p := LEAST(1.0 - 1e-9, GREATEST(1e-9, v_p));
  v_over  := 1.0 / v_p;
  v_under := 1.0 / (1.0 - v_p);

  -- No odds-feasibility clamp: every line prices FAIR (zero-vig), rounded to
  -- the 0.05 grid; 1.05 is the smallest storable grid step (bet_selections
  -- CHECK odds > 1.0). Availability is the CALLER's business (its acceptable
  -- line range) — never this function's. p_odds_min / p_odds_max / p_force
  -- are retained for signature compatibility and ignored.
  over_odds  := GREATEST(1.05, round(v_over  * 20) / 20);
  under_odds := GREATEST(1.05, round(v_under * 20) / 20);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_quote_internal(p_line numeric, p_seed_line numeric, p_seed_odds numeric, p_posted_odds numeric, p_enabled boolean, p_mean numeric, p_variance numeric, p_n_games integer, p_range_lo numeric, p_range_hi numeric, p_odds_min numeric, p_odds_max numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_mu       numeric;
  v_sigma    numeric;
  v_p_lo     double precision;
  v_p_hi     double precision;
  v_min_line numeric;
  v_max_line numeric;
  v_odds     numeric;
  v_under    numeric;
BEGIN
  IF NOT p_enabled OR p_mean IS NULL OR p_variance IS NULL OR p_variance <= 0 THEN
    -- Engine off (or no distribution): only posted lines are priceable — the
    -- band collapses to the seed and unposted lines return odds NULL.
    RETURN jsonb_build_object(
      'line', p_line,
      'odds', COALESCE(p_posted_odds, CASE WHEN p_line = p_seed_line THEN p_seed_odds END),
      'posted', p_posted_odds IS NOT NULL OR p_line = p_seed_line,
      'seed_line', p_seed_line, 'seed_odds', p_seed_odds,
      'min_line', p_seed_line, 'max_line', p_seed_line);
  END IF;

  v_mu    := p_mean * GREATEST(p_n_games, 1);
  v_sigma := sqrt(p_variance * GREATEST(p_n_games, 1));

  -- The HIGH edge is the stat's physical cap; the LOW edge is the smallest
  -- half-point paying the configured minimum multiplier (odds_min → 1.20):
  -- p_over ≤ 1/odds_min ⇔ line ≥ μ + Φ⁻¹(1 − 1/odds_min)·σ. Prices stay
  -- FAIR everywhere inside the band — this is an offer floor, not a clamp.
  v_min_line := ceil((v_mu + public.odds_engine_norm_ppf(1.0 - 1.0 / p_odds_min) * v_sigma)::numeric - 0.5) + 0.5;
  v_min_line := GREATEST(v_min_line, p_range_lo);
  v_min_line := LEAST(v_min_line, p_range_hi);
  v_max_line := p_range_hi;
  IF v_min_line > v_max_line THEN
    v_min_line := p_seed_line;
    v_max_line := p_seed_line;
  END IF;
  -- The seed is always offered (the minter forces it), so the selectable band
  -- must contain it even when the raw odds band doesn't.
  v_min_line := LEAST(v_min_line, p_seed_line);
  v_max_line := GREATEST(v_max_line, p_seed_line);

  IF p_posted_odds IS NOT NULL THEN
    -- Posted rungs are the book's standing offer — echoed verbatim, never
    -- re-quoted (a frozen market's rungs keep their frozen price).
    v_odds := p_posted_odds;
  ELSIF p_line < v_min_line OR p_line > v_max_line THEN
    -- Below the offer floor / outside the physical caps: not offered (the
    -- seed-containment above keeps the seed itself quotable).
    v_odds := NULL;
  ELSE
    SELECT pp.over_odds, pp.under_odds INTO v_odds, v_under
      FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, p_line,
                                         p_odds_min, p_odds_max, false) pp;
  END IF;

  RETURN jsonb_build_object(
    'line', p_line,
    'odds', v_odds,
    'posted', p_posted_odds IS NOT NULL,
    'seed_line', p_seed_line, 'seed_odds', p_seed_odds,
    'min_line', v_min_line, 'max_line', v_max_line);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_reladder_if_changed(p_market_id uuid, p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_changed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM (
      (SELECT s.key, s.label, s.odds, s.line, s.sort_order, s.side
         FROM public.bet_selections s WHERE s.market_id = p_market_id
       EXCEPT
       SELECT bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
         FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                              p_spacing, p_range_lo, p_range_hi, p_season_id) bl)
      UNION ALL
      (SELECT bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
         FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                              p_spacing, p_range_lo, p_range_hi, p_season_id) bl
       EXCEPT
       SELECT s.key, s.label, s.odds, s.line, s.sort_order, s.side
         FROM public.bet_selections s WHERE s.market_id = p_market_id)
    ) d
  ) INTO v_changed;

  IF v_changed THEN
    DELETE FROM public.bet_selections WHERE market_id = p_market_id;
    PERFORM public.odds_engine_mint_ladder(p_market_id, p_seed_line, p_mean, p_variance,
                                           p_n_games, p_spacing, p_range_lo, p_range_hi, p_season_id);
  END IF;
  RETURN v_changed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odds_engine_stat_rho(p_a text, p_b text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_a = p_b THEN 1.0::numeric
              ELSE COALESCE((SELECT c.rho FROM public.odds_engine_stat_corr c
                             WHERE c.stat_a = LEAST(p_a, p_b)
                               AND c.stat_b = GREATEST(p_a, p_b)), 0) END;
$function$
;

CREATE OR REPLACE FUNCTION public.open_auction_internal(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction   public.auctions;
  v_item_name text;
  v_item_icon text;
  v_week      uuid;
BEGIN
  UPDATE public.auctions
     SET status = 'open'
   WHERE id = p_auction_id AND status = 'scheduled';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT c.name, c.icon INTO v_item_name, v_item_icon
    FROM public.item_catalog c WHERE c.id = v_auction.catalog_item_id;

  -- The week this opening occurred in (the season's open week right now).
  SELECT id INTO v_week
    FROM public.weeks WHERE season_id = v_auction.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  PERFORM public.publish_activity_event(
    'auction_house', 'auction_opened',
    v_auction.season_id, v_week, NULL, NULL, NULL,
    NULL, NULL,
    'auction_house.opened',
    jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                       'minimum_bid', v_auction.minimum_bid, 'closes_at', v_auction.closes_at,
                       'quantity', v_auction.quantity),
    jsonb_build_object('auction_id', p_auction_id),
    NULL, now(),
    NULL, NULL, p_auction_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.open_auction_now(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_admin();

  SELECT status INTO v_status FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled auctions can be opened';
  END IF;

  UPDATE public.auctions SET opens_at = now() WHERE id = p_auction_id;
  PERFORM public.open_auction_internal(p_auction_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.parlay_price(p_week_id uuid DEFAULT NULL::uuid, p_picks jsonb DEFAULT NULL::jsonb, p_combos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_week uuid := p_week_id;
  v_season uuid;
  v_cfg public.odds_engine_config;
  v_legs jsonb := '[]'::jsonb;
  v_quoted numeric[] := '{}';
  v_pick jsonb;
  v_combo jsonb;
  v_mid uuid;
  v_m record;
  v_d record;
  v_stat text;
  v_subjects jsonb;
  v_members uuid[];
  v_cn integer;
  v_week_games integer;
  v_mu numeric;
  v_var numeric;
  v_factors numeric[];
  v_odds numeric := 1;
  v_corr boolean := false;
  v_n integer;
  i integer;
BEGIN
  IF v_week IS NULL AND p_picks IS NOT NULL AND jsonb_array_length(p_picks) > 0 THEN
    SELECT m.week_id INTO v_week FROM public.bet_markets m
      WHERE m.id = ((p_picks -> 0) ->> 'market_id')::uuid;
  END IF;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'A week (or at least one pick) is required';
  END IF;
  SELECT w.season_id INTO v_season FROM public.weeks w WHERE w.id = v_week;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'Week has no season';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season);

  SELECT COUNT(DISTINCT g.game_number) INTO v_week_games
    FROM public.games g JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = v_week;
  IF v_week_games IS NULL OR v_week_games = 0 THEN v_week_games := 2; END IF;

  FOR v_pick IN SELECT value FROM jsonb_array_elements(COALESCE(p_picks, '[]'::jsonb)) LOOP
    v_mid := (v_pick ->> 'market_id')::uuid;
    IF v_mid IS NULL OR (v_pick ->> 'quoted_odds') IS NULL THEN
      RAISE EXCEPTION 'Every pick needs a market_id and quoted_odds';
    END IF;
    SELECT m.market_type, m.subject_player_id, m.game_number, m.params INTO v_m
      FROM public.bet_markets m WHERE m.id = v_mid;
    v_stat := NULL; v_subjects := '[]'::jsonb;
    IF v_m.market_type = 'over_under' AND v_m.subject_player_id IS NOT NULL THEN
      v_stat := 'score'; v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'prop' AND v_m.subject_player_id IS NOT NULL
          AND (v_m.params ->> 'stat') IN ('strikes', 'spares', 'clean_frames') THEN
      v_stat := v_m.params ->> 'stat'; v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'combo'
          AND (v_m.params ->> 'stat') IN ('total_pins', 'strikes', 'spares', 'clean_frames') THEN
      v_stat := CASE WHEN v_m.params ->> 'stat' = 'total_pins' THEN 'score' ELSE v_m.params ->> 'stat' END;
      v_subjects := COALESCE(v_m.params -> 'member_ids', '[]'::jsonb);
    END IF;
    IF v_stat IS NOT NULL AND (v_pick ->> 'line') IS NOT NULL THEN
      SELECT d.mean, d.variance, d.n_games INTO v_d
        FROM public.odds_engine_market_distribution(v_mid) d;
      IF v_d.mean IS NOT NULL AND v_d.variance IS NOT NULL AND v_d.variance > 0 THEN
        v_legs := v_legs || jsonb_build_array(jsonb_build_object(
          'subjects', v_subjects, 'stat', v_stat,
          'game_number', v_m.game_number, 'n_games', v_d.n_games,
          'mu', v_d.mean * GREATEST(v_d.n_games, 1),
          'sigma', sqrt(v_d.variance * GREATEST(v_d.n_games, 1)),
          'line', (v_pick ->> 'line')::numeric, 'side', 'over',
          'quoted', (v_pick ->> 'quoted_odds')::numeric));
      ELSE
        v_stat := NULL;
      END IF;
    END IF;
    IF v_stat IS NULL THEN
      v_legs := v_legs || jsonb_build_array(jsonb_build_object(
        'subjects', '[]'::jsonb, 'stat', 'none', 'game_number', v_m.game_number,
        'n_games', 1, 'mu', 0, 'sigma', 0, 'line', 0, 'side', 'over'));
    END IF;
    v_quoted := v_quoted || (v_pick ->> 'quoted_odds')::numeric;
  END LOOP;

  FOR v_combo IN SELECT value FROM jsonb_array_elements(COALESCE(p_combos, '[]'::jsonb)) LOOP
    IF (v_combo ->> 'quoted_odds') IS NULL OR (v_combo ->> 'line') IS NULL THEN
      RAISE EXCEPTION 'Every combo needs a line and quoted_odds';
    END IF;
    SELECT array_agg(DISTINCT m::uuid) INTO v_members
      FROM jsonb_array_elements_text(v_combo -> 'member_ids') m;
    IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
      RAISE EXCEPTION 'A combo needs at least two distinct players';
    END IF;
    v_stat := CASE WHEN v_combo ->> 'stat' = 'total_pins' THEN 'score' ELSE v_combo ->> 'stat' END;
    IF v_stat NOT IN ('score', 'strikes', 'spares', 'clean_frames') THEN
      RAISE EXCEPTION 'Unknown combo stat %', COALESCE(v_combo ->> 'stat', '(null)');
    END IF;
    v_cn := CASE WHEN v_combo ->> 'scope' = 'game' THEN 1 ELSE v_week_games END;
    SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0) INTO v_mu, v_var
      FROM unnest(v_members) mem(m)
      CROSS JOIN LATERAL public.odds_engine_player_stat(mem.m, v_season, v_stat) ps;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'subjects', (SELECT jsonb_agg(m::text ORDER BY m) FROM unnest(v_members) m),
      'stat', v_stat,
      'game_number', CASE WHEN v_combo ->> 'scope' = 'game'
                          THEN (v_combo ->> 'game_number')::integer END,
      'n_games', v_cn,
      'mu', COALESCE(v_mu, 0) * v_cn,
      'sigma', CASE WHEN v_var > 0 THEN sqrt(v_var * v_cn) ELSE 0 END,
      'line', (v_combo ->> 'line')::numeric, 'side', 'over',
      'quoted', (v_combo ->> 'quoted_odds')::numeric));
    v_quoted := v_quoted || (v_combo ->> 'quoted_odds')::numeric;
  END LOOP;

  v_n := jsonb_array_length(v_legs);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Nothing to price';
  END IF;

  IF v_cfg.is_enabled AND v_n >= 2 THEN
    v_factors := public.odds_engine_parlay_factors_internal(v_legs, v_season);
  END IF;

  FOR i IN 1 .. v_n LOOP
    v_odds := v_odds * v_quoted[i] * COALESCE(v_factors[i], 1);
    IF v_factors[i] IS NOT NULL AND v_factors[i] <> 1 THEN v_corr := true; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'odds', round(v_odds, 2),
    'correlated', v_corr,
    'factors', COALESCE(to_jsonb(v_factors), 'null'::jsonb));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'CORRELATED_LEGS|%' THEN
    RETURN jsonb_build_object('blocked_player_id', NULLIF(split_part(SQLERRM, '|', 2), ''));
  END IF;
  RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pin_balance(p_player_id uuid, p_season_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(SUM(amount), 0)::integer
  FROM public.pin_ledger
  WHERE player_id = p_player_id AND season_id = p_season_id;
$function$
;

CREATE OR REPLACE FUNCTION public.pin_ledger_double_entry(p_player_id uuid, p_season_id uuid, p_week_id uuid, p_amount integer, p_type text, p_description text, p_house_description text DEFAULT NULL::text, p_bet_id uuid DEFAULT NULL::uuid, p_bounty_post_id uuid DEFAULT NULL::uuid, p_auction_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(player_entry_id uuid, house_entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.place_auction_bid(p_auction_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player   uuid;
  v_auction  public.auctions;
  v_bid_id   uuid;
  v_current  integer;
BEGIN
  v_player := public.current_player_id();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  -- Authoritative independent of cron lag: time check, not just status.
  IF v_auction.status <> 'open' OR now() >= v_auction.closes_at THEN
    RAISE EXCEPTION 'Auction is not open for bids';
  END IF;

  IF p_amount IS NULL OR p_amount < v_auction.minimum_bid THEN
    RAISE EXCEPTION 'Bid must be at least % pins', v_auction.minimum_bid;
  END IF;
  IF p_amount > public.pin_balance(v_player, v_auction.season_id) THEN
    RAISE EXCEPTION 'Bid exceeds your balance';
  END IF;

  SELECT id, public.decrypt_bid_amount(bid_amount_enc) INTO v_bid_id, v_current
    FROM public.auction_bids
   WHERE auction_id = p_auction_id AND player_id = v_player AND status = 'active';

  IF v_bid_id IS NOT NULL AND v_current = p_amount THEN
    RETURN;  -- no-op edit: tie-break clock preserved, idempotent success.
  END IF;

  IF v_bid_id IS NOT NULL THEN
    UPDATE public.auction_bids
       SET bid_amount_enc = public.encrypt_bid_amount(p_amount),
           submitted_at   = now()
     WHERE id = v_bid_id;
  ELSE
    INSERT INTO public.auction_bids (auction_id, player_id, bid_amount_enc)
      VALUES (p_auction_id, v_player, public.encrypt_bid_amount(p_amount));
  END IF;

  -- Recounted, never ±1 (self-healing denorm; we hold the auction lock).
  UPDATE public.auctions a
     SET bidder_count = (SELECT count(*) FROM public.auction_bids b
                          WHERE b.auction_id = a.id AND b.status = 'active')
   WHERE a.id = p_auction_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.place_bet_at_lines(p_picks jsonb, p_stake integer, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pick       jsonb;
  v_market_id  uuid;
  v_market_ids uuid[] := '{}';
  v_sel_ids    uuid[] := '{}';
BEGIN
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' OR jsonb_array_length(p_picks) < 1 THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;

  FOR v_pick IN SELECT value FROM jsonb_array_elements(p_picks) LOOP
    v_market_id := (v_pick ->> 'market_id')::uuid;
    IF v_market_id IS NULL THEN
      RAISE EXCEPTION 'Every pick needs a market_id';
    END IF;
    IF v_market_id = ANY (v_market_ids) THEN
      RAISE EXCEPTION 'The same market appears twice on this ticket';
    END IF;
    v_market_ids := v_market_ids || v_market_id;
    v_sel_ids := v_sel_ids || public.bet_mint_rung_internal(
      v_market_id, (v_pick ->> 'line')::numeric, (v_pick ->> 'quoted_odds')::numeric);
  END LOOP;

  RETURN public.place_house_bet(v_sel_ids, p_stake, NULL,
                                p_insurance_item_id, p_crutch_item_id, p_boost_item_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL::uuid, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
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
  v_line      public.custom_lines%ROWTYPE;
  v_boost_pct numeric := NULL;
  v_total_payout integer;
  v_leg_ids   uuid[]    := '{}';
  v_leg_mkts  uuid[]    := '{}';
  v_leg_odds  numeric[] := '{}';
  v_leg_lines numeric[] := '{}';
  v_leg_sides text[]    := '{}';
  v_factors   numeric[];
  i           integer;
BEGIN
  v_player_id := public.current_player_id();

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Custom line ("Special") tag: snapshot its display identity onto the bet.
  -- The selections themselves are client-resolved (same trust as the parlay
  -- slip); the line must simply exist and be live.
  IF p_custom_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.custom_lines WHERE id = p_custom_line_id;
    IF v_line.id IS NULL OR NOT v_line.is_active THEN
      RAISE EXCEPTION 'This special is no longer available';
    END IF;
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season AND
  -- a single week, and enforce anti-tanking. Each selection must belong to a
  -- distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.side, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE
      v_mseason   uuid;
      v_marchived boolean;
    BEGIN
      SELECT season_id, is_archived INTO v_mseason, v_marchived
        FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      -- A locked week (advanced or fully archived) takes no new stakes even if a
      -- prop market is still 'open' pending its next-day settlement clock.
      IF v_marchived THEN
        RAISE EXCEPTION 'This week is locked — no new bets can be placed';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Single-week invariant: bets.week_id is single-valued, so every leg must
    -- share the first leg's week.
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    ELSIF v_week_id <> v_sel.week_id THEN
      RAISE EXCEPTION 'All selections must be in the same week';
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.side = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_leg_ids   := v_leg_ids   || v_sel.selection_id;
    v_leg_mkts  := v_leg_mkts  || v_sel.market_id;
    v_leg_odds  := v_leg_odds  || v_sel.odds;
    v_leg_lines := v_leg_lines || v_sel.line;
    v_leg_sides := v_leg_sides || v_sel.side;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  -- Correlated-parlay repricing (SGP): legs on the same player in
  -- overlapping scopes (same game, or night↔game) cannot pay the product of
  -- marginals — each correlated pair is repriced off the joint bivariate
  -- model AT THE QUOTE-IMPLIED thresholds (p̂ = 1/stored odds), so the joint
  -- price is monotone vs. the singles even when a posted quote is stale or
  -- ceiling-clamped; the ratio is folded into the STORED leg odds, so
  -- settlement's product recompute (incl. Winner's Crutch leg drops) needs no
  -- change. Specials are admin-priced bundles — exempt. Engine off → NULL →
  -- legacy product. A ≥3-leg correlated cluster raises CORRELATED_LEGS|<player>.
  IF v_n >= 2 AND p_custom_line_id IS NULL THEN
    v_factors := public.odds_engine_parlay_market_factors(v_leg_mkts, v_leg_lines, v_leg_sides, v_leg_odds);
    IF v_factors IS NOT NULL THEN
      v_odds := 1;
      FOR i IN 1 .. v_n LOOP
        v_leg_odds[i] := round(v_leg_odds[i] * v_factors[i], 4);
        v_odds := v_odds * v_leg_odds[i];
      END LOOP;
    END IF;
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  v_balance := public.pin_balance(v_player_id, v_season_id);
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  -- Safety Ticket: validate the catalog contract, then consume the atomic item
  -- in one guarded UPDATE (owner + unconsumed + current season — rowcount 0
  -- means one of those failed). Spent at placement, win or lose; deliberately
  -- NO is_active check (retirement stops grants, never confiscates).
  IF p_insurance_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_insurance_item_id
         AND c.effect_type = 'bet_insurance'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not attachable bet insurance';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_insurance_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Safety Ticket is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Winner's Crutch: same consume posture as the Safety Ticket, but its own
  -- effect_type and a parlay floor — a crutch on a single can never help (cancel
  -- the only leg = nothing survives). Spent at placement, win or lose.
  IF p_crutch_item_id IS NOT NULL THEN
    IF v_n < 2 THEN
      RAISE EXCEPTION 'A Winner''s Crutch can only be attached to a parlay (2 or more legs)';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_crutch_item_id
         AND c.effect_type = 'parlay_crutch'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Winner''s Crutch';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_crutch_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Winner''s Crutch is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Energy Drink: same consume posture; its own effect_type, no leg floor (a
  -- boost helps any winning bet, single or parlay). Spent at placement, win or
  -- lose; the bonus is paid at settlement on a win. Its boost_pct is snapshotted
  -- onto the bet below so display + settlement share one locked-at-placement value.
  IF p_boost_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_boost_item_id
         AND c.effect_type = 'odds_boost'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Energy Drink';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_boost_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Energy Drink is not usable (already spent, wrong season, or not yours)';
    END IF;

    -- Lock the flavor's boost magnitude onto the bet (defaults to 1.0 if a row
    -- somehow omits it).
    SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_boost_item_id;
  END IF;

  INSERT INTO public.bets (player_id, season_id, week_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category,
                           insurance_item_id, crutch_item_id, boost_item_id, boost_pct)
    VALUES (v_player_id, v_season_id, v_week_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category,
            p_insurance_item_id, p_crutch_item_id, p_boost_item_id, v_boost_pct)
    RETURNING id INTO v_bet_id;

  -- Legs snapshot the (possibly correlation-repriced) odds gathered above —
  -- NOT re-read from bet_selections, so the stored product always equals the
  -- payout basis.
  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, u.sel_id, 'back', u.o, u.l
    FROM unnest(v_leg_ids, v_leg_odds, v_leg_lines) AS u(sel_id, o, l);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  PERFORM public.pin_ledger_double_entry(
    v_player_id, v_season_id, v_week_id,
    -p_stake, 'bet_stake', 'Bet placed', NULL, v_bet_id);

  -- Max possible payout INCLUSIVE of an attached boost — mirrors the settlement
  -- bonus formula (floor(payout × boost_pct) on top of the total payout).
  v_total_payout := v_payout
    + CASE WHEN v_boost_pct IS NOT NULL THEN FLOOR(v_payout * v_boost_pct)::integer ELSE 0 END;

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
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.player_raw_avg_score(p_player_id uuid, p_season_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_avg numeric;
BEGIN
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id AND w.is_archived = true
    AND ts.player_id = p_player_id AND s.score > 0;
  IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;

  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true AND ts.player_id = p_player_id AND s.score > 0;
  IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;

  SELECT COALESCE(AVG(s.score), 130) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;
  RETURN v_avg;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_create_draft(p_season_id uuid, p_week_id uuid, p_draft_type text, p_captain_player_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft_id uuid;
  v_i        integer;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can create a playoff draft';
  END IF;

  IF array_length(p_captain_player_ids, 1) IS NULL OR array_length(p_captain_player_ids, 1) < 2 THEN
    RAISE EXCEPTION 'At least 2 captains are required';
  END IF;
  IF (SELECT count(DISTINCT c) FROM unnest(p_captain_player_ids) c)
     <> array_length(p_captain_player_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate captain';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM weeks WHERE id = p_week_id AND season_id = p_season_id AND is_archived = false) THEN
    RAISE EXCEPTION 'Playoff week must be an unarchived week of the season';
  END IF;

  INSERT INTO playoff_drafts (season_id, week_id, draft_type)
    VALUES (p_season_id, p_week_id, COALESCE(p_draft_type, 'snake'))
    RETURNING id INTO v_draft_id;

  FOR v_i IN 1 .. array_length(p_captain_player_ids, 1) LOOP
    INSERT INTO playoff_draft_captains (draft_id, player_id, seed)
      VALUES (v_draft_id, p_captain_player_ids[v_i], v_i);
  END LOOP;

  INSERT INTO playoff_draft_pool (draft_id, player_id)
    SELECT v_draft_id, r.player_id
      FROM registrations r
      JOIN players p ON p.id = r.player_id AND p.is_active = true
     WHERE r.season_id = p_season_id
       AND r.player_id <> ALL (p_captain_player_ids);

  UPDATE weeks SET is_playoff = true, updated_at = now() WHERE id = p_week_id;

  RETURN v_draft_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_current_turn(p_draft_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_draft      public.playoff_drafts;
  v_n          integer;
  v_picks      integer;
  v_remaining  integer;
  v_k          integer;
  v_idx        integer;  -- 0-based position within the round
  v_round      integer;  -- 0-based round
  v_seed       integer;
BEGIN
  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id;
  IF v_draft.id IS NULL OR v_draft.status <> 'drafting' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_n FROM playoff_draft_captains WHERE draft_id = p_draft_id;
  IF v_n = 0 THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_picks FROM playoff_draft_picks WHERE draft_id = p_draft_id;

  SELECT count(*) INTO v_remaining
    FROM playoff_draft_pool pool
   WHERE pool.draft_id = p_draft_id
     AND NOT EXISTS (SELECT 1 FROM playoff_draft_picks pk
                      WHERE pk.draft_id = p_draft_id AND pk.picked_player_id = pool.player_id);
  IF v_remaining = 0 THEN RETURN NULL; END IF;

  v_k     := v_picks + 1;
  v_round := (v_k - 1) / v_n;
  v_idx   := (v_k - 1) % v_n;

  IF v_draft.draft_type = 'snake' AND v_round % 2 = 1 THEN
    v_seed := v_n - v_idx;
  ELSE
    v_seed := v_idx + 1;
  END IF;

  RETURN (SELECT player_id FROM playoff_draft_captains
           WHERE draft_id = p_draft_id AND seed = v_seed);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_make_pick(p_draft_id uuid, p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  uuid;
  v_is_admin   boolean;
  v_draft      public.playoff_drafts;
  v_on_clock   uuid;
  v_picks      integer;
  v_remaining  integer;
BEGIN
  v_is_admin := public.is_admin();
  SELECT id INTO v_caller_id FROM players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status <> 'drafting' THEN
    RAISE EXCEPTION 'Draft is not live';
  END IF;

  v_on_clock := playoff_current_turn(p_draft_id);
  IF v_on_clock IS NULL THEN
    RAISE EXCEPTION 'No pick is available';
  END IF;
  IF v_caller_id IS DISTINCT FROM v_on_clock AND NOT v_is_admin THEN
    RAISE EXCEPTION 'It is not your turn';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playoff_draft_pool
                  WHERE draft_id = p_draft_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'Player is not in the draft pool';
  END IF;
  IF EXISTS (SELECT 1 FROM playoff_draft_picks
              WHERE draft_id = p_draft_id AND picked_player_id = p_player_id) THEN
    RAISE EXCEPTION 'Player has already been drafted';
  END IF;

  SELECT count(*) INTO v_picks FROM playoff_draft_picks WHERE draft_id = p_draft_id;

  INSERT INTO playoff_draft_picks (draft_id, pick_number, captain_player_id, picked_player_id)
    VALUES (p_draft_id, v_picks + 1, v_on_clock, p_player_id);

  SELECT count(*) INTO v_remaining
    FROM playoff_draft_pool pool
   WHERE pool.draft_id = p_draft_id
     AND NOT EXISTS (SELECT 1 FROM playoff_draft_picks pk
                      WHERE pk.draft_id = p_draft_id AND pk.picked_player_id = pool.player_id);

  IF v_remaining = 0 THEN
    UPDATE playoff_drafts SET status = 'completed', updated_at = now() WHERE id = p_draft_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_materialize_teams(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_captain  record;
  v_team_id  uuid;
  v_slot     integer;
  v_pick     record;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can materialize playoff teams';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status <> 'completed' THEN
    RAISE EXCEPTION 'Draft must be completed before materializing (status %)', v_draft.status;
  END IF;
  IF EXISTS (SELECT 1 FROM teams WHERE week_id = v_draft.week_id) THEN
    RAISE EXCEPTION 'The playoff week already has teams';
  END IF;

  FOR v_captain IN
    SELECT player_id, seed FROM playoff_draft_captains
     WHERE draft_id = p_draft_id ORDER BY seed
  LOOP
    INSERT INTO teams (week_id, team_number)
      VALUES (v_draft.week_id, v_captain.seed)
      RETURNING id INTO v_team_id;

    INSERT INTO team_slots (team_id, slot, player_id)
      VALUES (v_team_id, 1, v_captain.player_id);

    v_slot := 1;
    FOR v_pick IN
      SELECT picked_player_id FROM playoff_draft_picks
       WHERE draft_id = p_draft_id AND captain_player_id = v_captain.player_id
       ORDER BY pick_number
    LOOP
      v_slot := v_slot + 1;
      INSERT INTO team_slots (team_id, slot, player_id)
        VALUES (v_team_id, v_slot, v_pick.picked_player_id);
    END LOOP;
  END LOOP;

  -- Matchups (weeks.getActive) only surfaces confirmed weeks — same flag the
  -- admin generate-teams flow sets once teams are locked.
  UPDATE weeks SET is_confirmed = true, updated_at = now() WHERE id = v_draft.week_id;

  UPDATE playoff_drafts SET status = 'materialized', updated_at = now() WHERE id = p_draft_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_reset_draft(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can reset a playoff draft';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  IF EXISTS (SELECT 1 FROM weeks WHERE id = v_draft.week_id AND is_archived = true) THEN
    RAISE EXCEPTION 'The playoff week is archived — unarchive it before resetting the draft';
  END IF;

  IF v_draft.status = 'materialized' THEN
    DELETE FROM teams WHERE week_id = v_draft.week_id;
    UPDATE weeks SET is_confirmed = false, updated_at = now() WHERE id = v_draft.week_id;
  END IF;

  UPDATE weeks SET is_playoff = false, updated_at = now() WHERE id = v_draft.week_id;

  DELETE FROM playoff_drafts WHERE id = p_draft_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.playoff_undo_pick(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_last     uuid;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can undo a pick';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status NOT IN ('drafting', 'completed') THEN
    RAISE EXCEPTION 'Draft is not undoable in status %', v_draft.status;
  END IF;

  SELECT id INTO v_last FROM playoff_draft_picks
   WHERE draft_id = p_draft_id ORDER BY pick_number DESC LIMIT 1;
  IF v_last IS NULL THEN
    RAISE EXCEPTION 'No picks to undo';
  END IF;

  DELETE FROM playoff_draft_picks WHERE id = v_last;

  IF v_draft.status = 'completed' THEN
    UPDATE playoff_drafts SET status = 'drafting', updated_at = now() WHERE id = p_draft_id;
  END IF;
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
 SET search_path TO 'public', 'pg_temp'
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
  v_bettor      uuid;
  v_subject     uuid;
  v_side        text;
  v_market_type text;
  v_params      jsonb;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.side, m.market_type, m.params
    INTO v_subject, v_side, v_market_type, v_params
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  -- Player markets: no backing the under (or laying the over) on your OWN line.
  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_side = 'under')
       OR (NEW.side = 'lay' AND v_side = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  -- Team markets: no backing the under (or laying the over) on a team the bettor
  -- is rostered on this week (betting your own team to do poorly).
  IF v_market_type = 'team_prop'
     AND ((NEW.side = 'back' AND v_side = 'under') OR (NEW.side = 'lay' AND v_side = 'over')) THEN
    IF EXISTS (
      SELECT 1 FROM public.team_slots ts
      WHERE ts.team_id = (v_params ->> 'team_id')::uuid
        AND ts.player_id = v_bettor
        AND ts.is_fill = false
    ) THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own team (anti-tanking)';
    END IF;
  END IF;

  -- Combo markets: no backing the under (or laying the over) on a combo whose
  -- member set contains the bettor. Backing your own over stays allowed.
  IF v_market_type = 'combo'
     AND ((NEW.side = 'back' AND v_side = 'under') OR (NEW.side = 'lay' AND v_side = 'over'))
     AND (v_params -> 'member_ids') ? v_bettor::text THEN
    RAISE EXCEPTION 'A player cannot bet against a combo containing themselves (anti-tanking)';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_settle_week(p_week_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt          record;
  v_stat         text;
  v_team_id      uuid;
  v_has          boolean;
  v_complete     boolean;
  v_official_n   integer;
  v_scored_n     integer;
  v_reason       text;
  v_settleable   integer := 0;
  v_would_void   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, subject_game_id, game_number, title, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND status <> 'settled'
  LOOP
    v_has    := false;
    v_reason := NULL;

    IF v_mkt.market_type = 'over_under' THEN
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
        ) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF v_mkt.market_type = 'moneyline' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) INTO v_has;
      v_reason := 'no scores recorded for the game';

    ELSIF v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'stat' = 'total_pins'
          AND v_mkt.params ->> 'clock' = 'archive' THEN
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;
      IF v_mkt.subject_game_id IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores sc
          JOIN public.team_slots ts ON ts.id = sc.team_slot_id
          WHERE ts.team_id = v_team_id AND sc.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF (v_mkt.market_type = 'prop' AND v_mkt.params ->> 'source' = 'lanetalk')
       OR (v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'clock' = 'lanetalk') THEN
      v_stat := v_mkt.params ->> 'stat';
      v_reason := 'awaiting LaneTalk import';

      IF v_mkt.market_type = 'team_prop' THEN
        v_team_id := (v_mkt.params ->> 'team_id')::uuid;
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            JOIN public.scores s ON s.team_slot_id = ts.id
            JOIN public.games g  ON g.id = s.game_id
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.lanetalk_game_imports i
                WHERE i.week_id = p_week_id AND i.player_id = ts.player_id
                  AND i.game_number = g.game_number AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.game_number = v_mkt.game_number AND i.classification = 'official';
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND (SELECT count(*) FROM public.scores s WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
                > (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = ts.player_id AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.classification = 'official';
        END IF;
        v_has := (v_complete AND v_official_n > 0);
      ELSE
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT EXISTS (
            SELECT 1 FROM public.lanetalk_game_imports i
            WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id
              AND i.game_number = v_mkt.game_number AND i.classification = 'official'
          ) INTO v_has;
        ELSE
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id AND i.classification = 'official';
          SELECT count(*) INTO v_scored_n
          FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL;
          v_has := (v_official_n > 0 AND v_official_n >= v_scored_n);
        END IF;
      END IF;

    ELSIF v_mkt.market_type = 'combo' THEN
      -- Mirrors settle_week (c'''): complete only when EVERY member has data
      -- for the combo's scope and clock.
      v_stat := v_mkt.params ->> 'stat';

      IF v_stat = 'total_pins' THEN
        v_reason := 'a combo member has no recorded score';
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.scores s
              JOIN public.team_slots ts ON ts.id = s.team_slot_id
              JOIN public.teams t       ON t.id = ts.team_id
              JOIN public.games g       ON g.id = s.game_id
              WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                AND ts.is_fill = false AND g.game_number = v_mkt.game_number
                AND s.score IS NOT NULL)
          ) INTO v_has;
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.scores s
              JOIN public.team_slots ts ON ts.id = s.team_slot_id
              JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                AND ts.is_fill = false AND s.score IS NOT NULL)
          ) INTO v_has;
        END IF;
      ELSE
        v_reason := 'a combo member is awaiting LaneTalk import';
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.lanetalk_game_imports i
              WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                AND i.game_number = v_mkt.game_number AND i.classification = 'official')
          ) INTO v_has;
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                     AND i.classification = 'official') = 0
               OR (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                     AND i.classification = 'official')
                < (SELECT count(*) FROM public.scores s
                   JOIN public.games g       ON g.id = s.game_id
                   JOIN public.team_slots ts ON ts.id = s.team_slot_id
                   JOIN public.teams t       ON t.id = ts.team_id
                   WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                     AND ts.is_fill = false AND s.score IS NOT NULL)
          ) INTO v_has;
        END IF;
      END IF;

    ELSE
      -- Any other non-settled market (shouldn't reach settlement) — treat as
      -- settleable so it isn't flagged as a spurious void.
      v_has := true;
    END IF;

    IF v_has THEN
      v_settleable := v_settleable + 1;
    ELSE
      v_would_void := v_would_void || jsonb_build_object(
        'market_id', v_mkt.id,
        'market_type', v_mkt.market_type,
        'title', v_mkt.title,
        'reason', v_reason);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'settleable', v_settleable,
    'missing_count', jsonb_array_length(v_would_void),
    'would_void', v_would_void);
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
  PERFORM public.assert_admin();

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
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_loan.player_id, v_loan.season_id, p_week_id,
          -v_garnish, 'loan_weekly_garnishment', 'Loan garnishment');

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

CREATE OR REPLACE FUNCTION public.publish_activity_event(p_source_feature text, p_event_type text, p_season_id uuid, p_week_id uuid, p_actor_player_id uuid, p_subject_player_id uuid, p_secondary_player_id uuid, p_sportsbook_bet_id uuid, p_loan_id uuid, p_template_key text, p_public_payload jsonb, p_admin_payload jsonb, p_visibility text, p_occurred_at timestamp with time zone, p_pvp_challenge_id uuid DEFAULT NULL::uuid, p_bounty_post_id uuid DEFAULT NULL::uuid, p_auction_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cat        public.activity_event_catalog;
  v_n_fks      integer;
  v_provided   text;
  v_visibility text;
  v_id         uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','bounty_board','auction_house','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Catalog lookup. RAISE on unknown event_type.
  SELECT * INTO v_cat FROM public.activity_event_catalog WHERE event_type = p_event_type;
  IF v_cat.event_type IS NULL THEN
    RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END IF;

  -- 3. Source-FK ↔ feature consistency: exactly the catalog's allowed FK is
  --    set (all others NULL); 'none' means no FK at all.
  v_n_fks := (p_sportsbook_bet_id IS NOT NULL)::int + (p_loan_id IS NOT NULL)::int
           + (p_pvp_challenge_id IS NOT NULL)::int + (p_bounty_post_id IS NOT NULL)::int
           + (p_auction_id IS NOT NULL)::int;
  v_provided := CASE
    WHEN p_sportsbook_bet_id IS NOT NULL THEN 'sportsbook_bet_id'
    WHEN p_loan_id           IS NOT NULL THEN 'loan_id'
    WHEN p_pvp_challenge_id  IS NOT NULL THEN 'pvp_challenge_id'
    WHEN p_bounty_post_id    IS NOT NULL THEN 'bounty_post_id'
    WHEN p_auction_id        IS NOT NULL THEN 'auction_id'
    ELSE 'none' END;
  IF v_n_fks > 1 OR v_provided <> v_cat.allowed_fk THEN
    RAISE EXCEPTION 'Event % requires source FK % only (got %, % set)',
      p_event_type, v_cat.allowed_fk, v_provided, v_n_fks;
  END IF;

  -- 4. Actor requirement.
  IF v_cat.requires_actor AND p_actor_player_id IS NULL THEN
    RAISE EXCEPTION 'Event % requires an actor_player_id', p_event_type;
  END IF;

  -- 5. template_key must match the catalog (keeps copy controlled).
  IF p_template_key IS DISTINCT FROM v_cat.template_key THEN
    RAISE EXCEPTION 'template_key % does not match catalog template % for event %',
      p_template_key, v_cat.template_key, p_event_type;
  END IF;

  -- 6. Apply catalog default visibility.
  v_visibility := COALESCE(p_visibility, v_cat.default_visibility);

  -- 7. Insert (idempotent via the partial unique dedup indexes).
  INSERT INTO public.activity_feed_events (
    season_id, week_id, source_feature, event_type,
    actor_player_id, subject_player_id, secondary_player_id,
    sportsbook_bet_id, loan_id, pvp_challenge_id, bounty_post_id, auction_id,
    visibility, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id, p_pvp_challenge_id, p_bounty_post_id, p_auction_id,
    v_visibility, 'published',
    v_cat.template_key, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
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
  -- 1. Season-specific: player's mean of THIS season's archived bowled scores.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id
    AND w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score > 0;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- 2. Lifetime: player's mean across ALL archived seasons.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score > 0;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- 3. Fallback: games-weighted, all-time league average (Σscore / Σgames).
  -- player_id IS NOT NULL excludes fill slots (fills carry a null player).
  SELECT COALESCE(AVG(s.score), 130) INTO v_league_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true
    AND ts.player_id IS NOT NULL
    AND s.score > 0;

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

CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text DEFAULT 'ios'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
BEGIN
  v_player_id := public.current_player_id();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player for the current user';
  END IF;
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'A push token is required';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Unknown platform %', p_platform;
  END IF;

  INSERT INTO public.push_tokens (player_id, expo_push_token, platform)
  VALUES (v_player_id, btrim(p_token), p_platform)
  ON CONFLICT (expo_push_token)
  DO UPDATE SET player_id = EXCLUDED.player_id,
                platform = EXCLUDED.platform,
                last_registered_at = now();
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
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.render_broadcast_event_template(p_template text, p_event activity_feed_events)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_out  text := p_template;
  v_name text;
  v_key  text;
BEGIN
  IF position('{actor}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.actor_player_id;
    v_out := replace(v_out, '{actor}', COALESCE(v_name, 'Someone'));
  END IF;
  IF position('{subject}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.subject_player_id;
    v_out := replace(v_out, '{subject}', COALESCE(v_name, 'Someone'));
  END IF;
  IF position('{secondary}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.secondary_player_id;
    v_out := replace(v_out, '{secondary}', COALESCE(v_name, 'Someone'));
  END IF;

  FOR v_key IN
    SELECT DISTINCT m[1]
      FROM regexp_matches(v_out, '\{payload\.([a-zA-Z0-9_]+)\}', 'g') AS m
  LOOP
    v_out := replace(v_out, '{payload.' || v_key || '}',
                     COALESCE(p_event.public_payload ->> v_key, ''));
  END LOOP;

  RETURN v_out;
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
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
  v_risk_level  text;
BEGIN
  v_player_id := public.current_player_id();

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

  IF p_amount > public.pin_balance(v_player_id, v_loan.season_id) THEN
    RAISE EXCEPTION 'Repayment exceeds your balance';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_loan.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_player_id, v_loan.season_id, v_week_id,
      -p_amount, 'loan_manual_repayment', 'Loan repayment');

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

CREATE OR REPLACE FUNCTION public.reset_recurring_schedule_last_fired()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
     OR NEW.send_time IS DISTINCT FROM OLD.send_time
     OR NEW.timezone  IS DISTINCT FROM OLD.timezone
     OR (NEW.enabled AND NOT OLD.enabled) THEN
    NEW.last_fired_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_rsvp_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  IF p_week_id IS NULL THEN
    RAISE EXCEPTION 'week id is required';
  END IF;

  -- Revoke the week's RSVP bonuses (player + house mirror), then clear RSVPs.
  DELETE FROM public.pin_ledger WHERE week_id = p_week_id AND type = 'rsvp_bonus';
  DELETE FROM public.rsvp       WHERE week_id = p_week_id;
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
  PERFORM public.assert_admin();

  UPDATE public.activity_feed_events
    SET status = 'published',
        suppressed_by_admin_id = NULL,
        suppressed_at = NULL,
        suppression_reason = NULL
    WHERE id = p_event_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  PERFORM public.sync_lanetalk_prop_markets_for_week(p_week_id);
  PERFORM public.sync_combo_markets_for_week(p_week_id);
  -- team_prop + moneyline generation retired (combos replaced them);
  -- p_moneyline is kept in the signature for the games trigger but is inert.
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reverse_settled_auction(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction public.auctions;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'settled' THEN
    RAISE EXCEPTION 'Only settled auctions can be reversed';
  END IF;

  -- Revoke the granted items by their provenance FK — never by heuristics.
  -- All or nothing: one consumed item blocks the whole reversal.
  IF EXISTS (
    SELECT 1 FROM public.player_inventory_items
     WHERE auction_id = p_auction_id AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A won item has already been used — this auction cannot be reversed';
  END IF;
  DELETE FROM public.player_inventory_items WHERE auction_id = p_auction_id;

  -- Claw back every pair (purchases + bounces) by the root ref.
  DELETE FROM public.pin_ledger WHERE auction_id = p_auction_id;

  -- Erase the auction; the won bids + feed rows cascade. As if it never happened.
  DELETE FROM public.auctions WHERE id = p_auction_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_inventory_item(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item public.player_inventory_items;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_item FROM public.player_inventory_items
   WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  IF v_item.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This item has already been used and cannot be removed';
  END IF;

  -- Defensive: unconsumed items are never referenced, but never dangle a live
  -- bet/haunt link if that invariant ever slips.
  IF EXISTS (
    SELECT 1 FROM public.bets
     WHERE insurance_item_id = p_item_id
        OR crutch_item_id = p_item_id
        OR boost_item_id = p_item_id
  ) OR EXISTS (
    SELECT 1 FROM public.bet_haunts WHERE inventory_item_id = p_item_id
  ) THEN
    RAISE EXCEPTION 'This item is attached to a bet and cannot be removed';
  END IF;

  DELETE FROM public.player_inventory_items WHERE id = p_item_id;
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

CREATE OR REPLACE FUNCTION public.set_auction_house_closed(p_is_closed boolean, p_closed_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season uuid;
  v_msg    text;
BEGIN
  PERFORM public.assert_admin();

  v_season := public.current_season_id();
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  v_msg := NULLIF(btrim(COALESCE(p_closed_message, '')), '');

  INSERT INTO public.auction_house_state (season_id, is_closed, closed_message, updated_at, updated_by)
    VALUES (v_season, COALESCE(p_is_closed, false), v_msg, now(), public.current_player_id())
  ON CONFLICT (season_id) DO UPDATE
    SET is_closed      = EXCLUDED.is_closed,
        closed_message = EXCLUDED.closed_message,
        updated_at     = now(),
        updated_by     = EXCLUDED.updated_by;
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

CREATE OR REPLACE FUNCTION public.settle_auction(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction public.auctions;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'open' THEN
    RAISE EXCEPTION 'Only open auctions can be settled';
  END IF;

  IF v_auction.closes_at > now() THEN
    UPDATE public.auctions SET closes_at = now() WHERE id = p_auction_id;
  END IF;

  PERFORM public.settle_auction_internal(p_auction_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_auction_internal(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction      public.auctions;
  v_item_name    text;
  v_item_icon    text;
  v_catalog_id   uuid;
  v_week         uuid;
  v_bid          record;
  v_balance      integer;
  v_fee          integer;
  v_bidder_count integer;
  v_bounce_count integer := 0;
  v_sold         integer := 0;
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  -- Idempotent + the single timing rule (no override parameter exists).
  IF v_auction.status <> 'open' OR v_auction.closes_at > now() THEN
    RETURN;
  END IF;

  SELECT name, icon, id INTO v_item_name, v_item_icon, v_catalog_id
    FROM public.item_catalog WHERE id = v_auction.catalog_item_id;

  -- Week stamp: the season's open week at settlement time (accounting
  -- accuracy; the archive engine is auction-exempt). Shared by the ledger
  -- pairs AND the feed events below.
  SELECT id INTO v_week
    FROM public.weeks WHERE season_id = v_auction.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  SELECT count(*) INTO v_bidder_count
    FROM public.auction_bids WHERE auction_id = p_auction_id AND status = 'active';

  -- Rank: first-price, ties to whoever held their amount longest. Multi-unit:
  -- pay-as-bid, sell-what-sells — each affordable bidder takes one unit (one
  -- per player via the one-active-bid index) until quantity units are gone.
  FOR v_bid IN
    SELECT b.id, b.player_id,
           public.decrypt_bid_amount(b.bid_amount_enc) AS amount,
           b.submitted_at
      FROM public.auction_bids b
     WHERE b.auction_id = p_auction_id AND b.status = 'active'
     ORDER BY amount DESC, b.submitted_at ASC
  LOOP
    v_balance := public.pin_balance(v_bid.player_id, v_auction.season_id);

    IF v_balance >= v_bid.amount THEN
      PERFORM public.pin_ledger_double_entry(
        v_bid.player_id, v_auction.season_id, v_week,
        -v_bid.amount, 'auction_purchase',
        'Won at auction: ' || v_item_name,
        NULL, NULL, NULL, p_auction_id);

      INSERT INTO public.player_inventory_items
          (player_id, catalog_item_id, season_id, source, auction_id)
        VALUES (v_bid.player_id, v_catalog_id, v_auction.season_id, 'auction', p_auction_id);

      UPDATE public.auction_bids
         SET status = 'won', settled_at = now()
       WHERE id = v_bid.id;

      v_sold := v_sold + 1;

      -- The denorm headline is the hammer price: the first (highest) winner.
      IF v_sold = 1 THEN
        UPDATE public.auctions
           SET winner_player_id = v_bid.player_id,
               winning_bid_id   = v_bid.id,
               winning_price    = v_bid.amount
         WHERE id = p_auction_id;
      END IF;

      PERFORM public.publish_activity_event(
        'auction_house', 'auction_won',
        v_auction.season_id, v_week, v_bid.player_id, NULL, NULL,
        NULL, NULL,
        'auction_house.won',
        jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                           'price', v_bid.amount),
        jsonb_build_object('auction_id', p_auction_id),
        NULL, now(),
        NULL, NULL, p_auction_id);

      EXIT WHEN v_sold >= v_auction.quantity;
    ELSE
      -- Check bounce: ledger-silent at zero fee, feed-loud always. The event
      -- names the player + fee — NEVER the pledged amount.
      v_bounce_count := v_bounce_count + 1;
      v_fee := LEAST(v_balance, v_auction.bounce_fee);
      IF v_fee > 0 THEN
        PERFORM public.pin_ledger_double_entry(
          v_bid.player_id, v_auction.season_id, v_week,
          -v_fee, 'auction_check_bounce',
          'Bounced check at auction: ' || v_item_name,
          NULL, NULL, NULL, p_auction_id);
      END IF;

      PERFORM public.publish_activity_event(
        'auction_house', 'auction_check_bounce',
        v_auction.season_id, v_week, v_bid.player_id, NULL, NULL,
        NULL, NULL,
        'auction_house.check_bounce',
        jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                           'fee', v_fee),
        jsonb_build_object('auction_id', p_auction_id),
        NULL, now(),
        NULL, NULL, p_auction_id);
    END IF;
  END LOOP;

  UPDATE public.auctions
     SET status = 'settled', settled_at = now()
   WHERE id = p_auction_id;

  -- A rejected pledge is destroyed: every non-won row, bounced included.
  DELETE FROM public.auction_bids
   WHERE auction_id = p_auction_id AND status <> 'won';

  IF v_sold = 0 THEN
    PERFORM public.publish_activity_event(
      'auction_house', 'auction_no_sale',
      v_auction.season_id, v_week, NULL, NULL, NULL,
      NULL, NULL,
      'auction_house.no_sale',
      jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                         'bidder_count', v_bidder_count, 'bounce_count', v_bounce_count),
      jsonb_build_object('auction_id', p_auction_id),
      NULL, now(),
      NULL, NULL, p_auction_id);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid, p_force boolean DEFAULT false)
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
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week. Stamp week_id so the entry
  -- groups under the correct week in the per-player ledger.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE week_id = p_week_id AND type = 'score_credit'
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
  -- Game markets: the subject's score for that game. Night markets
  -- (game_number NULL): Σ the subject's non-fill scores across the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    IF v_mkt.game_number IS NOT NULL THEN
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
    ELSE
      SELECT SUM(s.score)::integer INTO v_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;
    END IF;

    IF v_score IS NULL THEN
      -- No score -> close without a result (bets caught by the backstop below).
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

  -- Settle every non-settled team_prop TOTAL PINS market (archive clock).
  -- Game markets: team pinfall = Σ scores of the anchored team for that game
  -- (the moneyline aggregation). Night markets (subject_game_id NULL): Σ the
  -- team's non-NULL scores across ALL the week's games — fills INCLUDED
  -- (score-sheet semantics; frame-stat team props count non-fill roster
  -- imports instead). Frame-stat team_props (clock='lanetalk') settle later
  -- via settle_lanetalk_props_for_week and are skipped here.
  FOR v_mkt IN
    SELECT id, subject_game_id, (params ->> 'team_id')::uuid AS team_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'team_prop'
      AND params ->> 'stat' = 'total_pins' AND params ->> 'clock' = 'archive'
      AND status <> 'settled'
  LOOP
    IF v_mkt.subject_game_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.scores
        WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE sc.game_id = v_mkt.subject_game_id
          AND ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    ELSE
      -- Night total_pins: team_slots are week-scoped through their team, so
      -- every score reached through them belongs to this week's games.
      IF EXISTS (
        SELECT 1 FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id AND sc.score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    END IF;
  END LOOP;

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- Backstop: settlement must leave NO pending sportsbook bet, whatever market
  -- type or roster disconnect produced it. Without force: abort (the whole
  -- archive transaction rolls back) and name the unsettleable markets. With
  -- force: void those bets and refund their stakes. The void is snapshot-
  -- reversible — bets/bet_legs pre-images are captured by archive_week, and the
  -- bet_refund rows are bet-linked (and week-stamped) so unarchive deletes them.
  --
  -- EXEMPTION: bets with ≥1 leg on an UNSETTLED next-day-clock market are left
  -- pending — LaneTalk player props (market_type='prop') and LaneTalk-clock
  -- team_props (market_type='team_prop', params.clock='lanetalk'). Their data
  -- lands after archive; settle_lanetalk_props_for_week settles them on Confirm.
  -- total_pins team_props (clock='archive') are NOT exempt — settled just above.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.status <> 'settled'
        AND (m2.market_type = 'prop'
             OR m2.market_type = 'combo'
             OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
    );

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND NOT (m.market_type = 'prop'
                 OR m.market_type = 'combo'
                 OR (m.market_type = 'team_prop' AND m.params ->> 'clock' = 'lanetalk'))
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        );

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      WHERE b.week_id = p_week_id AND b.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        )
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at archive — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  -- bet_id remains the authoritative link for bet money; bets.week_id scopes the week.
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
    WHERE pl.is_house = true
      AND pl.type IN ('bet_stake','bet_payout','bet_refund')
      AND pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

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
  PERFORM public.assert_admin();
  v_admin_id := public.current_player_id();

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

      PERFORM public.pin_ledger_double_entry(
        v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id,
        v_total_stakes + v_escrow, 'bounty_payout', 'Bounty sponsor won',
        NULL, NULL, p_bounty_post_id);
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

      PERFORM public.pin_ledger_double_entry(
        v_stake.player_id, v_bounty.season_id, v_bounty.week_id,
        v_payout, 'bounty_payout', 'Bounty hunter won',
        NULL, NULL, p_bounty_post_id);
    END LOOP;

    -- Return the sponsor's unused escrow ((max_hunters - n) * R) for a sponsor bounty.
    IF v_bounty.bounty_type = 'sponsor_bounty' AND v_unused_escrow > 0 THEN
      PERFORM public.pin_ledger_double_entry(
        v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id,
        v_unused_escrow, 'bounty_payout', 'Bounty unused escrow returned',
        NULL, NULL, p_bounty_post_id);
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

CREATE OR REPLACE FUNCTION public.settle_lanetalk_props_for_week(p_week_id uuid, p_void_missing boolean DEFAULT false)
 RETURNS TABLE(settled integer, voided integer, left_pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v jsonb;
BEGIN
  v := public.settle_week(p_week_id, p_void_missing, false);
  RETURN QUERY SELECT (v ->> 'settled')::integer, (v ->> 'voided')::integer, (v ->> 'left_pending')::integer;
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
  v_payment     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  PERFORM public.assert_admin();

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

    v_payment := LEAST(public.pin_balance(v_loan.player_id, v_loan.season_id), v_outstanding);
    IF v_payment > 0 THEN
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_loan.player_id, v_loan.season_id, v_week_id,
          -v_payment, 'loan_season_close_settlement', 'Season-close loan settlement');

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
  PERFORM public.assert_admin();
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
  IF v_market.market_type NOT IN ('over_under', 'prop', 'team_prop', 'combo') THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under/prop/team_prop/combo markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results (side-aware — ladders carry many over/under pairs,
  -- each graded against its OWN line): over wins above the line, under below;
  -- half-point lines never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.side = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.side = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
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
  PERFORM public.assert_admin();
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
    PERFORM public.assert_admin();
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
        SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
          FROM public.pin_ledger_double_entry(
            v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
            -v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded');

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
  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_winner_id, v_challenge.season_id, v_challenge.week_id,
      v_challenge.total_pot, 'pvp_payout', 'PvP challenge won');

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
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.settle_week(p_week_id uuid, p_void_missing boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_is_archived boolean;
  v_run_id      uuid;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
  -- LaneTalk fold locals
  v_stat        text;
  v_value       numeric;
  v_team_id     uuid;
  v_complete    boolean;
  v_official_n  integer;
  v_scored_n    integer;
  v_settled     integer := 0;
  v_voided      integer := 0;
  v_pending     integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number, is_archived
    INTO v_season_id, v_week_number, v_is_archived
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF NOT v_is_archived THEN
    RAISE EXCEPTION 'Week must be advanced (locked) before it can be settled';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week — advance it first';
  END IF;

  -- --------------------------------------------------------------------------
  -- Money snapshot capture, phase='settle', ONCE per run. Skipped on re-settle
  -- so the snapshot pins the pre-FIRST-settle state; re-settle is additive via
  -- the per-step guards and stays reversible by unsettle/unarchive.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.week_archive_snapshot WHERE run_id = v_run_id AND phase = 'settle') THEN
    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pin_ledger', pl.id, 'settle'
      FROM public.pin_ledger pl
     WHERE pl.week_id = p_week_id
        OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'loan_ledger', ll.id, 'settle'
      FROM public.loan_ledger ll WHERE ll.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pvp_ledger', pv.id, 'settle'
      FROM public.pvp_ledger pv WHERE pv.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'activity_feed_events', af.id, 'settle'
      FROM public.activity_feed_events af WHERE af.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_markets', m.id,
           jsonb_build_object('status', m.status, 'result_value', m.result_value, 'settled_at', m.settled_at), 'settle'
      FROM public.bet_markets m WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_selections', s.id,
           jsonb_build_object('result', s.result), 'settle'
      FROM public.bet_selections s
      JOIN public.bet_markets m ON m.id = s.market_id
     WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bets', b.id,
           jsonb_build_object('status', b.status, 'potential_payout', b.potential_payout, 'settled_at', b.settled_at), 'settle'
      FROM public.bets b WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_legs', l.id,
           jsonb_build_object('result', l.result), 'settle'
      FROM public.bet_legs l
      JOIN public.bets b ON b.id = l.bet_id
     WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenges', c.id,
           jsonb_build_object('status', c.status, 'winner_player_id', c.winner_player_id,
                              'result_detail', c.result_detail, 'settled_at', c.settled_at,
                              'admin_note', c.admin_note), 'settle'
      FROM public.pvp_challenges c WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenge_offers', o.id,
           jsonb_build_object('superseded_at', o.superseded_at, 'accepted_at', o.accepted_at,
                              'declined_at', o.declined_at), 'settle'
      FROM public.pvp_challenge_offers o
      JOIN public.pvp_challenges c ON c.id = o.challenge_id
     WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'loans', ln.id,
           jsonb_build_object('status', ln.status, 'paid_off_at', ln.paid_off_at), 'settle'
      FROM public.loans ln
     WHERE ln.season_id = v_season_id AND ln.status = 'active';
  END IF;

  -- (a) Score credits (player-only mints), once per week.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE week_id = p_week_id AND type = 'score_credit'
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

  -- (b) O/U settlement. Game markets: subject's game score. Night markets
  --     (game_number NULL): Σ subject's non-fill scores across the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    IF v_mkt.game_number IS NOT NULL THEN
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
    ELSE
      SELECT SUM(s.score)::integer INTO v_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;
    END IF;

    IF v_score IS NULL THEN
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- (c) Moneyline settlement.
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

  -- (c') team_prop TOTAL PINS markets (archive clock).
  FOR v_mkt IN
    SELECT id, subject_game_id, (params ->> 'team_id')::uuid AS team_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'team_prop'
      AND params ->> 'stat' = 'total_pins' AND params ->> 'clock' = 'archive'
      AND status <> 'settled'
  LOOP
    IF v_mkt.subject_game_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.scores
        WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE sc.game_id = v_mkt.subject_game_id
          AND ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id AND sc.score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    END IF;
  END LOOP;

  -- (c'') LaneTalk player + team props (FOLDED IN from
  --       settle_lanetalk_props_for_week). Settles off official imports; markets
  --       with no gradable value are delete-refunded when p_void_missing, else
  --       left pending (exempt from the backstop below).
  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND status IN ('open', 'closed')
      AND ((market_type = 'prop' AND params ->> 'source' = 'lanetalk')
        OR (market_type = 'team_prop' AND params ->> 'clock' = 'lanetalk'))
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_mkt.market_type = 'team_prop' THEN
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
        RAISE EXCEPTION 'Unknown LaneTalk team stat % on market %', v_stat, v_mkt.id;
      END IF;
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          JOIN public.scores s ON s.team_slot_id = ts.id
          JOIN public.games g  ON g.id = s.game_id
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.lanetalk_game_imports i
              WHERE i.week_id = p_week_id
                AND i.player_id = ts.player_id
                AND i.game_number = g.game_number
                AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.game_number = v_mkt.game_number
            AND i.classification = 'official';
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND (SELECT count(*) FROM public.scores s
                 WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
              > (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = ts.player_id
                   AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.classification = 'official'
            AND i.frames > 0;
        END IF;
      END IF;

    ELSE
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
        RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
      END IF;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT CASE v_stat
                 WHEN 'strikes'        THEN st.strikes::numeric
                 WHEN 'spares'         THEN st.spares::numeric
                 WHEN 'clean_frames'   THEN (st.strikes + st.spares)::numeric
                 WHEN 'clean_pct'      THEN st.clean_pct
                 WHEN 'first_ball_avg' THEN st.first_ball_avg
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official'
        LIMIT 1;
      ELSE
        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official';

        SELECT count(*) INTO v_scored_n
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = p_week_id
          AND ts.player_id = v_mkt.subject_player_id
          AND ts.is_fill = false
          AND s.score IS NOT NULL;

        IF v_official_n > 0 AND v_official_n >= v_scored_n THEN
          SELECT CASE v_stat
                   WHEN 'strikes'        THEN SUM(st.strikes)::numeric
                   WHEN 'spares'         THEN SUM(st.spares)::numeric
                   WHEN 'clean_frames'   THEN (SUM(st.strikes) + SUM(st.spares))::numeric
                   WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                   WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
                 END
            INTO v_value
          FROM public.lanetalk_game_imports i
          CROSS JOIN LATERAL (
            SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg, i.frames
          ) st
          WHERE i.week_id = p_week_id
            AND i.player_id = v_mkt.subject_player_id
            AND i.classification = 'official'
            AND st.frames > 0;
        END IF;
      END IF;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (c''') Combo markets (BOTH clocks): Σ member stats vs the line. A combo
  --        settles only when EVERY member has complete data for its scope —
  --        an absent member never silently settles the sum low. Missing data
  --        ⇒ delete-refund when p_void_missing (the refund-trigger rail),
  --        else left pending (exempt from the backstop below, both clocks:
  --        an archive-clock combo missing a member score will never
  --        self-heal, but preview flags it and voidMissing resolves it).
  FOR v_mkt IN
    SELECT id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'combo'
      AND status IN ('open', 'closed')
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_stat = 'total_pins' THEN
      -- Archive clock: settle from scores.
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.scores s
            JOIN public.team_slots ts ON ts.id = s.team_slot_id
            JOIN public.teams t       ON t.id = ts.team_id
            JOIN public.games g       ON g.id = s.game_id
            WHERE t.week_id = p_week_id
              AND ts.player_id = mem.pid::uuid
              AND ts.is_fill = false
              AND g.game_number = v_mkt.game_number
              AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(s.score)::numeric INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.team_slots ts ON ts.player_id = mem.pid::uuid AND ts.is_fill = false
          JOIN public.teams t       ON t.id = ts.team_id AND t.week_id = p_week_id
          JOIN public.scores s      ON s.team_slot_id = ts.id
          JOIN public.games g       ON g.id = s.game_id AND g.game_number = v_mkt.game_number
          WHERE s.score IS NOT NULL;
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.scores s
            JOIN public.team_slots ts ON ts.id = s.team_slot_id
            JOIN public.teams t       ON t.id = ts.team_id
            WHERE t.week_id = p_week_id
              AND ts.player_id = mem.pid::uuid
              AND ts.is_fill = false
              AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(s.score)::numeric INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.team_slots ts ON ts.player_id = mem.pid::uuid AND ts.is_fill = false
          JOIN public.teams t       ON t.id = ts.team_id AND t.week_id = p_week_id
          JOIN public.scores s      ON s.team_slot_id = ts.id
          WHERE s.score IS NOT NULL;
        END IF;
      END IF;

    ELSIF v_stat IN ('strikes', 'spares', 'clean_frames') THEN
      -- LaneTalk clock: settle from official imports.
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.lanetalk_game_imports i
            WHERE i.week_id = p_week_id
              AND i.player_id = mem.pid::uuid
              AND i.game_number = v_mkt.game_number
              AND i.classification = 'official')
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.lanetalk_game_imports i
            ON i.player_id = mem.pid::uuid
          WHERE i.week_id = p_week_id
            AND i.game_number = v_mkt.game_number
            AND i.classification = 'official';
        END IF;
      ELSE
        -- Night: per member, official imports must cover every recorded score
        -- and exist at all (the c'' player-night predicate, applied per member).
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = mem.pid::uuid
                   AND i.classification = 'official') = 0
             OR (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = mem.pid::uuid
                   AND i.classification = 'official')
              < (SELECT count(*) FROM public.scores s
                 JOIN public.games g       ON g.id = s.game_id
                 JOIN public.team_slots ts ON ts.id = s.team_slot_id
                 JOIN public.teams t       ON t.id = ts.team_id
                 WHERE t.week_id = p_week_id
                   AND ts.player_id = mem.pid::uuid
                   AND ts.is_fill = false
                   AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.lanetalk_game_imports i
            ON i.player_id = mem.pid::uuid
          WHERE i.week_id = p_week_id
            AND i.classification = 'official'
            AND i.frames > 0;
        END IF;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unknown combo stat % on market %', v_stat, v_mkt.id;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (d) Loan garnishment + interest.
  PERFORM public.process_weekly_loans(p_week_id);

  -- (e) PvP: auto-settle locked contracts for this week.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- (f) Backstop, NARROWED. Props now settle in (c'') above, so the exemption
  --     is no longer blanket: a bet is exempt from the pending-count/void ONLY
  --     when p_void_missing = false AND it has a leg on a still-unsettled
  --     next-day-clock market (LaneTalk player prop or LaneTalk-clock team_prop)
  --     — i.e. a market genuinely still lacking import data. With
  --     p_void_missing = true those markets were delete-refunded in (c''), so no
  --     such legs remain and the exemption is inert.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND (p_void_missing OR NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.status <> 'settled'
        AND (m2.market_type = 'prop'
             OR m2.market_type = 'combo'
             OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
    ));

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ));

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      WHERE b.week_id = p_week_id AND b.status = 'pending'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ))
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at settlement — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- (g) UNIFIED House weekly P/L — computed once, over ALL week-anchored house
  --     ledger rows (bets incl. LaneTalk payouts, PvP, loan garnishment),
  --     EXCLUDING bounty/auction (own feed cards + own clocks). UPSERT so a
  --     re-settle after a late import refreshes it (stable row id).
  -- --------------------------------------------------------------------------
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
   WHERE pl.is_house = true
     AND pl.week_id = p_week_id
     AND pl.auction_id IS NULL
     AND pl.bounty_post_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    UPDATE public.activity_feed_events
       SET public_payload = jsonb_set(COALESCE(public_payload, '{}'::jsonb), '{house_net}', to_jsonb(v_house_net)),
           updated_at = now()
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result';
  ELSE
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;

  -- Mark settled (preserve first-settle time across re-settles).
  UPDATE public.weeks SET settled_at = now() WHERE id = p_week_id AND settled_at IS NULL;

  UPDATE public.week_archive_runs
     SET details = details || jsonb_build_object(
           'settled_at', now(),
           'settle_counts', jsonb_build_object(
             'settled', v_settled, 'voided', v_voided,
             'left_pending', v_pending, 'house_net', v_house_net))
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'settled', v_settled, 'voided', v_voided,
    'left_pending', v_pending, 'house_net', v_house_net);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_own_rsvp(p_week_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player   uuid;
  v_week     public.weeks%ROWTYPE;
  v_season   public.seasons%ROWTYPE;
  v_cfg      public.rsvp_bonus_config%ROWTYPE;
  v_deadline timestamptz;
  v_desc     text;
  v_awarded  boolean := false;
  v_amount   integer := 0;
  v_reason   text;
BEGIN
  -- 1. Caller → player.
  SELECT id INTO v_player FROM public.players WHERE user_id = auth.uid();
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'No player is linked to the current user';
  END IF;

  -- 2. Status.
  IF p_status IS NULL OR p_status NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'RSVP status must be ''in'' or ''out''';
  END IF;

  -- 3. Week must exist, not be archived, and belong to the current playing
  --    season (is_active AND NOT registration_open — the getCurrent() rule).
  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF v_week.is_archived THEN
    RAISE EXCEPTION 'This week is archived — RSVPs are closed';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = v_week.season_id;
  IF v_season.id IS NULL OR NOT v_season.is_active OR v_season.registration_open THEN
    RAISE EXCEPTION 'This week is not in the current playing season';
  END IF;

  -- 4. Upsert the caller's OWN row (never anyone else's).
  INSERT INTO public.rsvp (week_id, player_id, status)
    VALUES (p_week_id, v_player, p_status)
  ON CONFLICT (player_id, week_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  -- 5. Resolve config: current-season row first, else global.
  SELECT * INTO v_cfg FROM public.rsvp_bonus_config
    WHERE season_id = v_season.id;
  IF v_cfg.id IS NULL THEN
    SELECT * INTO v_cfg FROM public.rsvp_bonus_config
      WHERE season_id IS NULL;
  END IF;

  -- 6. Award, guarded.
  IF v_cfg.id IS NULL OR NOT v_cfg.is_enabled THEN
    v_reason := 'disabled';
  ELSIF EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE player_id = v_player AND week_id = p_week_id AND type = 'rsvp_bonus'
  ) THEN
    v_reason := 'already_claimed';
  ELSE
    -- bowled_at NULL ⇒ deadline unknown ⇒ treat as not yet passed.
    IF v_week.bowled_at IS NOT NULL THEN
      v_deadline := (v_week.bowled_at + v_cfg.deadline_time) AT TIME ZONE v_cfg.timezone;
    END IF;

    IF v_deadline IS NOT NULL AND now() > v_deadline THEN
      v_reason := 'past_deadline';
    ELSE
      v_desc := format('RSVP Bonus - Season %s Week %s', v_season.number, v_week.week_number);
      PERFORM public.pin_ledger_double_entry(
        v_player, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        v_desc, v_desc || ' (House)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
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
  PERFORM public.assert_admin();

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();

  UPDATE public.activity_feed_events
    SET status = 'suppressed',
        suppressed_by_admin_id = v_admin_id,
        suppressed_at = now(),
        suppression_reason = p_reason
    WHERE id = p_event_id;

  -- Cancel the coupled push if it hasn't been claimed by the sweep yet.
  UPDATE public.broadcasts
     SET status = 'canceled'
   WHERE source = 'event'
     AND status = 'pending'
     AND data ->> 'activity_event_id' = p_event_id::text;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_auctions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Phase 1: open what's due.
  FOR v_id IN
    SELECT id FROM public.auctions
     WHERE status = 'scheduled' AND opens_at <= now()
     ORDER BY opens_at
  LOOP
    BEGIN
      PERFORM public.open_auction_internal(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sweep_auctions: open failed for %: %', v_id, SQLERRM;
    END;
  END LOOP;

  -- Phase 2: settle what's due.
  FOR v_id IN
    SELECT id FROM public.auctions
     WHERE status = 'open' AND closes_at <= now()
     ORDER BY closes_at
  LOOP
    BEGIN
      PERFORM public.settle_auction_internal(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sweep_auctions: settle failed for %: %', v_id, SQLERRM;
    END;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_combo_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'combo'
     AND m.status IN ('open', 'closed')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(m.params -> 'member_ids') mem(pid)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.rsvp r
         WHERE r.week_id = m.week_id
           AND r.player_id = mem.pid::uuid
           AND r.status = 'in'));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lanetalk_prop_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_has_teams    boolean;
  v_has_games    boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_rec          record;
  v_market_id    uuid;
  v_line         numeric;
  v_cfg          public.odds_engine_config;
  v_mean         numeric;
  v_var          numeric;
  v_sl           record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season_id);

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: the schedule once it exists; before teams, existing prop
  -- market numbers, defaulting to {1, 2} (same policy as the O/U sync).
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT g.game_number FROM public.games g
        JOIN public.teams t ON t.id = g.team_a_id
       WHERE t.week_id = p_week_id
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT game_number FROM public.bet_markets
       WHERE week_id = p_week_id AND market_type = 'prop'
         AND params ->> 'source' = 'lanetalk' AND game_number IS NOT NULL
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  -- --- Prune: refund + remove every open/closed lanetalk prop whose subject ---
  -- lost eligibility (ladder ∩ official history) or whose game number left the
  -- schedule. A stat leaving the catalog (first_ball_avg retirement) prunes
  -- ONLY betless markets — a market carrying bets keeps its stat settleable.
  -- Night markets (game_number NULL) follow the subject's standing in ANY
  -- target game. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND (
       (m.params ->> 'stat' NOT IN ('strikes', 'spares', 'clean_frames')
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l
          JOIN public.bet_selections s ON s.id = l.selection_id
          WHERE s.market_id = m.id))
       -- no official import history → no line
       OR NOT EXISTS (
         SELECT 1 FROM public.lanetalk_game_imports i
         WHERE i.player_id = m.subject_player_id
           AND i.classification = 'official'
           AND i.frames > 0)
       OR (m.game_number IS NOT NULL AND m.game_number <> ALL (v_target_games))
       OR (m.game_number IS NOT NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (m.game_number IS NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- Create missing per-game markets (strikes + spares + clean frames) ----
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name,
           sl.strikes_line, sl.spares_line, sl.clean_frames_per_game
    FROM (
      -- games exist → participation rows are the authority, per game
      SELECT DISTINCT ts.player_id, g.game_number
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      -- teams but no games yet (mid-team-gen) → slots × target
      SELECT ts.player_id, gt.game_number
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      -- no teams → RSVP × target
      SELECT r.player_id, gt.game_number
      FROM public.rsvp r
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    -- zero seed rows = no official history → no markets for this player
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'strikes') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_rec.strikes_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_rec.spares_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      -- Per-game clean seed line: floor+0.5 on the per-game average, clamped
      -- inside the possible range (10 frames a game).
      v_line := LEAST(9.5, GREATEST(0.5, floor(v_rec.clean_frames_per_game) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;
  END LOOP;

  -- --- Create missing night markets (clean frames + strikes + spares) -------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name,
           sl.strikes_per_game, sl.spares_per_game, sl.clean_frames_per_game
    FROM (
      SELECT DISTINCT ts.player_id
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      SELECT ts.player_id
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      SELECT r.player_id
      FROM public.rsvp r
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    -- Night seed lines: per-game average scaled to this week's schedule,
    -- floored ONCE to a half so it can't push, clamped inside the possible
    -- range (10 frames a game — the money definitions count FRAMES, so 10·n
    -- is the true ceiling for strikes, spares, and clean frames alike).
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.clean_frames_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.strikes_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'strikes') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.spares_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;

  -- --- Re-ladder: unbet open/closed markets track new imports (line drift ---
  -- AND recency-weighted odds drift). Never touches a market under a placed
  -- bet; ids only churn when the posted ladder actually changed. Legacy
  -- stats (first_ball_avg) are skipped — frozen as before.
  FOR v_rec IN
    SELECT m.id AS market_id, m.subject_player_id, m.game_number,
           m.params ->> 'stat' AS stat
    FROM public.bet_markets m
    WHERE m.week_id = p_week_id
      AND m.market_type = 'prop'
      AND m.params ->> 'source' = 'lanetalk'
      AND m.status IN ('open', 'closed')
      AND m.params ->> 'stat' IN ('strikes', 'spares', 'clean_frames')
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s2 ON s2.id = l.selection_id
        WHERE s2.market_id = m.id)
  LOOP
    SELECT sl.* INTO v_sl FROM public.lanetalk_seed_lines(v_rec.subject_player_id) sl;
    IF v_sl IS NULL OR v_sl.strikes_per_game IS NULL THEN
      CONTINUE;  -- no official history (the prune above handles removal)
    END IF;

    v_line := CASE
      WHEN v_rec.stat = 'strikes' AND v_rec.game_number IS NOT NULL THEN v_sl.strikes_line
      WHEN v_rec.stat = 'strikes' THEN LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.strikes_per_game * v_n_games) + 0.5))
      WHEN v_rec.stat = 'spares' AND v_rec.game_number IS NOT NULL THEN v_sl.spares_line
      WHEN v_rec.stat = 'spares' THEN LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.spares_per_game * v_n_games) + 0.5))
      WHEN v_rec.game_number IS NOT NULL THEN
             LEAST(9.5, GREATEST(0.5, floor(v_sl.clean_frames_per_game) + 0.5))
      ELSE LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.clean_frames_per_game * v_n_games) + 0.5))
    END;

    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.subject_player_id, v_season_id, v_rec.stat) ps;

    IF v_rec.game_number IS NOT NULL THEN
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    ELSE
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_moneyline_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Retired: moneyline markets are no longer generated. Kept as a no-op so
  -- app builds that still call it (team gen / add game / playoffs) don't
  -- error. Safe to DROP once every client is past the combo-lines release.
  NULL;
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
  v_has_teams    boolean;
  v_has_games    boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
  v_cfg          public.odds_engine_config;
  v_mean         numeric;
  v_var          numeric;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season_id);

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: once a schedule exists the games table is authoritative
  -- (∪ p_extra_games for a just-inserted game in the same client flow).
  -- Before teams: existing market numbers ∪ extras, defaulting to {1, 2}.
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT g.game_number AS x FROM public.games g
          JOIN public.teams t ON t.id = g.team_a_id
         WHERE t.week_id = p_week_id
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT game_number AS x FROM public.bet_markets
          WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  -- --- Prune: refund + remove every O/U market whose subject is no longer ---
  -- eligible (per the ladder above) or whose game number is no longer
  -- scheduled. Night markets (game_number NULL) follow the subject's standing
  -- in ANY game, like the night stat props. The BEFORE DELETE trigger
  -- (refund_bets_before_market_delete) refunds every touched bet whole (ledger
  -- pair + bet row), including parlays spanning other markets. Settled/void
  -- markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status IN ('open', 'closed')
     AND (
       (m.game_number IS NOT NULL AND m.game_number <> ALL (v_target_games))
       OR (m.game_number IS NOT NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (m.game_number IS NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- Re-ladder: rebuild line + priced rungs on every OPEN market with no ---
  -- bets, so re-syncs pick up new history AND fresh recency-weighted odds.
  -- Selection ids only churn when the posted ladder actually changed
  -- (odds_engine_reladder_if_changed). Markets with any bet stay frozen.
  FOR v_rec IN
    SELECT m.id AS market_id, m.subject_player_id, m.game_number
    FROM public.bet_markets m
    WHERE m.week_id = p_week_id
      AND m.market_type = 'over_under'
      AND m.status = 'open'
      AND m.subject_player_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_legs bl
        JOIN public.bet_selections s2 ON s2.id = bl.selection_id
        WHERE s2.market_id = m.id
      )
  LOOP
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.subject_player_id, v_season_id, 'score') ps;
    IF v_rec.game_number IS NOT NULL THEN
      v_line := public.pvp_player_line(v_rec.subject_player_id, v_season_id);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_score, 0.5, 299.5, v_season_id);
    ELSE
      v_line := GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.subject_player_id, v_season_id) * v_n_games) + 0.5);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_night_pins, 0.5, 300 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;

  -- --- Create missing markets for eligible (player, game) pairs ---------------
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name
    FROM (
      -- games exist → participation rows are the authority, per game
      SELECT DISTINCT ts.player_id, g.game_number
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      -- teams but no games yet (mid-team-gen) → slots × target
      SELECT ts.player_id, gt.game_number
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      -- no teams → RSVP × target
      SELECT r.player_id, gt.game_number
      FROM public.rsvp r
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = ep.game_number AND m.subject_player_id = ep.player_id
    )
  LOOP
    -- Season → lifetime → league ladder, shared with PvP lines (seed rung).
    v_line := public.pvp_player_line(v_rec.player_id, v_season_id);
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    PERFORM public.odds_engine_mint_ladder(
      v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_score, 0.5, 299.5, v_season_id);
  END LOOP;

  -- --- Create missing NIGHT markets (player total pins across the night) ------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name
    FROM (
      SELECT DISTINCT ts.player_id
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      SELECT ts.player_id
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      SELECT r.player_id
      FROM public.rsvp r
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number IS NULL AND m.subject_player_id = ep.player_id
    )
  LOOP
    v_line := GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.player_id, v_season_id) * v_n_games) + 0.5);
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
      VALUES ('over_under', v_rec.name || ' Total Pins — Night',
              p_week_id, NULL, v_rec.player_id,
              jsonb_build_object('scope', 'night'), 'open')
      RETURNING id INTO v_market_id;

    PERFORM public.odds_engine_mint_ladder(
      v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_night_pins, 0.5, 300 * v_n_games - 0.5, v_season_id);
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
  v_player_id := public.current_player_id();
  v_season_id := public.current_season_id();

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

  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_player_id, v_season_id, v_week_id,
      v_product.borrow_amount, 'loan_issued',
      'Loan issued: ' || v_product.display_name,
      'Loan issued (house): ' || v_product.display_name);

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

CREATE OR REPLACE FUNCTION public.team_prop_seed_line(p_team_id uuid, p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_roster integer;
  v_sum    numeric;
BEGIN
  SELECT count(*) INTO v_roster
  FROM public.team_slots ts
  WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
  IF v_roster = 0 THEN v_roster := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    SELECT COALESCE(SUM(pl.avg_stat), 0) INTO v_sum
    FROM public.team_slots ts
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = ts.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    -- Half-point, floored once; clamp to [0.5, 10 frames/game × games × roster − 0.5].
    RETURN LEAST(10 * p_n_games * v_roster - 0.5,
                 GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(public.player_raw_avg_score(ts.player_id, p_season_id)), 0) INTO v_sum
    FROM public.team_slots ts
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    RETURN GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown team_prop stat %', p_stat;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_lanetalk_import_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE st record;
BEGIN
  SELECT * INTO st FROM public.lanetalk_game_stats(NEW.payload);
  NEW.frames         := jsonb_array_length(COALESCE(NEW.payload -> 'frames', '[]'::jsonb));
  NEW.strikes        := st.strikes;
  NEW.spares         := st.spares;
  NEW.clean_pct      := st.clean_pct;
  NEW.first_ball_avg := st.first_ball_avg;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_resync_markets_games()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr JOIN public.teams t ON t.id = nr.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM (
        SELECT team_a_id FROM new_rows UNION SELECT team_a_id FROM old_rows
      ) u JOIN public.teams t ON t.id = u.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o JOIN public.teams t ON t.id = o.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_resync_markets_rsvp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN SELECT DISTINCT week_id FROM new_rows LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT week_id FROM (
        SELECT week_id FROM new_rows UNION SELECT week_id FROM old_rows
      ) u
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN SELECT DISTINCT week_id FROM old_rows LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_resync_markets_scores()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr
      JOIN public.team_slots ts ON ts.id = nr.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o
      JOIN public.team_slots ts ON ts.id = o.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_resync_markets_team_slots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr JOIN public.teams t ON t.id = nr.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM (
        SELECT team_id FROM new_rows UNION SELECT team_id FROM old_rows
      ) u JOIN public.teams t ON t.id = u.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o JOIN public.teams t ON t.id = o.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_seed_participation_games()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.scores (team_slot_id, game_id, score)
  SELECT ts.id, nr.id, NULL
  FROM new_rows nr
  JOIN public.team_slots ts ON ts.team_id IN (nr.team_a_id, nr.team_b_id)
  ON CONFLICT (team_slot_id, game_id) DO NOTHING;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unarchive_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id     uuid;
  v_week_number   integer;
  v_settled_at    timestamptz;
  v_run_id        uuid;
  v_next_week_id  uuid;
  v_n_scores      integer := 0;
  v_n_bets        integer := 0;
  v_n_pvp         integer := 0;
  v_n_loans       integer := 0;
  v_n_rsvp        integer := 0;
  v_n_ledger      integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number, settled_at INTO v_season_id, v_week_number, v_settled_at
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- LIFO: only the most-recently-archived week can be unarchived.
  IF EXISTS (
    SELECT 1 FROM public.weeks w
     WHERE w.season_id = v_season_id AND w.is_archived = true AND w.week_number > v_week_number
  ) THEN
    RAISE EXCEPTION 'A later week is archived — unarchive the most recent week first';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week';
  END IF;

  SELECT id INTO v_next_week_id
    FROM public.weeks WHERE season_id = v_season_id AND week_number = v_week_number + 1;

  -- Downstream guard: warn (unless forced) if week N+1 holds real activity.
  IF v_next_week_id IS NOT NULL AND NOT p_force THEN
    SELECT count(*) INTO v_n_scores
      FROM public.scores sc
      JOIN public.team_slots ts ON ts.id = sc.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
     WHERE t.week_id = v_next_week_id AND sc.score IS NOT NULL;

    SELECT count(*) INTO v_n_bets
      FROM public.bets b WHERE b.week_id = v_next_week_id;

    SELECT count(*) INTO v_n_pvp  FROM public.pvp_challenges WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_rsvp FROM public.rsvp           WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_ledger FROM public.pin_ledger   WHERE week_id = v_next_week_id;

    IF (v_n_scores + v_n_bets + v_n_pvp + v_n_rsvp + v_n_ledger) > 0 THEN
      RAISE EXCEPTION 'Downstream activity in week %: % scores, % bets, % pvp, % rsvp, % ledger rows. Re-run with force to override.',
        v_week_number + 1, v_n_scores, v_n_bets, v_n_pvp, v_n_rsvp, v_n_ledger;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- MONEY REVERSAL (phase='settle') — only if the week was actually settled.
  -- CRITICAL: gated on settled_at. On an advanced-but-UNSETTLED week there are
  -- no phase='settle' preexisting rows, so a `NOT IN (empty set)` delete would
  -- wipe every pre-existing ledger row. The gate makes the money reversal a
  -- no-op for the advanced-unsettled state.
  -- --------------------------------------------------------------------------
  IF v_settled_at IS NOT NULL THEN
    DELETE FROM public.activity_feed_events a
     WHERE a.week_id = p_week_id
       AND a.auction_id IS NULL
       AND a.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'activity_feed_events' AND phase = 'settle'
       );

    DELETE FROM public.pin_ledger pl
     WHERE (pl.week_id = p_week_id
            OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
       AND pl.auction_id IS NULL
       AND pl.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'pin_ledger' AND phase = 'settle'
       );

    DELETE FROM public.pvp_ledger pv
     WHERE pv.week_id = p_week_id
       AND pv.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'pvp_ledger' AND phase = 'settle'
       );

    DELETE FROM public.loan_ledger ll
     WHERE ll.week_id = p_week_id
       AND ll.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'loan_ledger' AND phase = 'settle'
       );

    UPDATE public.bet_markets m SET
        status       = sn.payload ->> 'status',
        result_value = (sn.payload ->> 'result_value')::numeric,
        settled_at   = (sn.payload ->> 'settled_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

    UPDATE public.bet_selections s SET
        result = sn.payload ->> 'result'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

    UPDATE public.bets b SET
        status           = sn.payload ->> 'status',
        potential_payout = (sn.payload ->> 'potential_payout')::integer,
        settled_at       = (sn.payload ->> 'settled_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bets' AND sn.pk = b.id;

    UPDATE public.bet_legs l SET
        result = sn.payload ->> 'result'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

    UPDATE public.pvp_challenges c SET
        status           = sn.payload ->> 'status',
        winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
        result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
        settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
        admin_note       = sn.payload ->> 'admin_note'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

    UPDATE public.pvp_challenge_offers o SET
        superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
        accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
        declined_at   = (sn.payload ->> 'declined_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

    UPDATE public.loans ln SET
        status      = sn.payload ->> 'status',
        paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'loans' AND sn.pk = ln.id;
  END IF;

  -- --------------------------------------------------------------------------
  -- ADVANCE REVERSAL (both states) — revert the phase='advance' fill scores,
  -- destroy week N+1, reopen week N.
  -- --------------------------------------------------------------------------
  UPDATE public.scores s SET
      score = (sn.payload ->> 'score')::integer
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'advance'
     AND sn.table_name = 'scores' AND sn.pk = s.id;

  IF v_next_week_id IS NOT NULL THEN
    DELETE FROM public.rsvp  WHERE week_id = v_next_week_id;
    DELETE FROM public.weeks WHERE id = v_next_week_id;
  END IF;

  -- Reopen week N. bowled_at is DELIBERATELY preserved — it is the immutable
  -- scheduled bowl-Monday now, and must survive so a re-import still binds.
  UPDATE public.weeks SET is_archived = false, settled_at = NULL WHERE id = p_week_id;

  UPDATE public.week_archive_runs
     SET status = 'reversed', reversed_mode = 'unarchive', reversed_at = now()
   WHERE id = v_run_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.push_tokens
   WHERE expo_push_token = btrim(p_token)
     AND player_id = public.current_player_id();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unsettle_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_is_archived boolean;
  v_settled_at  timestamptz;
  v_run_id      uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, is_archived, settled_at
    INTO v_season_id, v_is_archived, v_settled_at
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF NOT v_is_archived THEN
    RAISE EXCEPTION 'Week is not advanced — nothing to unsettle';
  END IF;
  IF v_settled_at IS NULL THEN
    RAISE EXCEPTION 'Week is advanced but not settled — nothing to unsettle';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week';
  END IF;

  -- 1. Delete what settlement INSERTed (rows matching the predicate whose id is
  --    NOT in the run's phase='settle' preexisting set). Auction rows excluded —
  --    they reverse only via reverse_settled_auction.
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.auction_id IS NULL
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'activity_feed_events' AND phase = 'settle'
     );

  DELETE FROM public.pin_ledger pl
   WHERE (pl.week_id = p_week_id
          OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
     AND pl.auction_id IS NULL
     AND pl.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'pin_ledger' AND phase = 'settle'
     );

  DELETE FROM public.pvp_ledger pv
   WHERE pv.week_id = p_week_id
     AND pv.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'pvp_ledger' AND phase = 'settle'
     );

  DELETE FROM public.loan_ledger ll
   WHERE ll.week_id = p_week_id
     AND ll.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'loan_ledger' AND phase = 'settle'
     );

  -- 2. Restore what settlement UPDATEd (phase='settle' pre-images). NOT the
  --    'scores' fill preimages — those are phase='advance' and the week stays
  --    locked, so the frozen scores remain for re-settle to grade on.
  UPDATE public.bet_markets m SET
      status       = sn.payload ->> 'status',
      result_value = (sn.payload ->> 'result_value')::numeric,
      settled_at   = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

  UPDATE public.bet_selections s SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

  UPDATE public.bets b SET
      status           = sn.payload ->> 'status',
      potential_payout = (sn.payload ->> 'potential_payout')::integer,
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bets' AND sn.pk = b.id;

  UPDATE public.bet_legs l SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

  UPDATE public.pvp_challenges c SET
      status           = sn.payload ->> 'status',
      winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
      result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
      admin_note       = sn.payload ->> 'admin_note'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

  UPDATE public.pvp_challenge_offers o SET
      superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
      accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
      declined_at   = (sn.payload ->> 'declined_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

  UPDATE public.loans ln SET
      status      = sn.payload ->> 'status',
      paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'loans' AND sn.pk = ln.id;

  -- 3. Back to advanced-unsettled. Run stays 'active'.
  UPDATE public.weeks SET settled_at = NULL WHERE id = p_week_id;

  -- 4. Drop the phase='settle' snapshot rows so the next settle_week re-captures
  --    a clean pre-settle image.
  DELETE FROM public.week_archive_snapshot
   WHERE run_id = v_run_id AND phase = 'settle';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_auction(p_auction_id uuid, p_catalog_key text, p_description text, p_minimum_bid integer, p_opens_at timestamp with time zone, p_closes_at timestamp with time zone, p_quantity integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction public.auctions;
  v_cat     public.item_catalog;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Auction metadata is frozen once it opens';
  END IF;

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL OR NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Unknown or retired catalog item: %', p_catalog_key;
  END IF;
  IF p_closes_at IS NULL OR p_closes_at <= now() OR p_closes_at <= COALESCE(p_opens_at, now()) THEN
    RAISE EXCEPTION 'Close time must be in the future and after open time';
  END IF;
  IF p_minimum_bid IS NULL OR p_minimum_bid <= 0 THEN
    RAISE EXCEPTION 'Minimum bid must be at least 1';
  END IF;
  IF p_quantity IS NOT NULL AND p_quantity NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;

  UPDATE public.auctions
     SET catalog_item_id = v_cat.id,
         description     = p_description,
         minimum_bid     = p_minimum_bid,
         opens_at        = COALESCE(p_opens_at, opens_at),
         closes_at       = p_closes_at,
         quantity        = COALESCE(p_quantity, quantity)
   WHERE id = p_auction_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_catalog_item(p_catalog_item_id uuid, p_name text, p_description text, p_icon text, p_effect_type text, p_effect_params jsonb, p_activation_mode text, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  PERFORM public.assert_admin();

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
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_row.player_id, v_row.season_id, v_row.week_id,
          -v_row.amount, 'pvp_refund', 'PvP void — settlement reversed');

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
    SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
      FROM public.pin_ledger_double_entry(
        v_row.player_id, v_row.season_id, v_row.week_id,
        -v_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded');

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

CREATE OR REPLACE FUNCTION public.weeks_derive_bowled_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_prev_bowled   date;
  v_start_date    date;
  v_bowling_night text;
BEGIN
  IF NEW.bowled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Chain: the previous week's actual date + 7. Survives schedule slips the
  -- season-start formula below cannot see (the 2026-07-20 collision incident).
  SELECT bowled_at INTO v_prev_bowled
    FROM public.weeks
   WHERE season_id = NEW.season_id AND week_number = NEW.week_number - 1;
  IF v_prev_bowled IS NOT NULL THEN
    NEW.bowled_at := v_prev_bowled + 7;
    RETURN NEW;
  END IF;

  SELECT start_date, bowling_night
    INTO v_start_date, v_bowling_night
    FROM public.seasons
   WHERE id = NEW.season_id;

  -- No season row yet (shouldn't happen — season_id is NOT NULL FK) → leave NULL.
  IF v_start_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- No prior week to chain from: scheduled bowl day = the season's start
  -- Monday plus one week per week_number.
  NEW.bowled_at := v_start_date + ((NEW.week_number - 1) * 7);

  -- The formula (and parseLanetalk.toMonday) assume a Monday cadence. Flag any
  -- season whose start weekday disagrees with its declared bowling_night as a
  -- latent mismatch the LaneTalk parser would need generalized for — a warning,
  -- not a block, so week creation always succeeds.
  IF v_bowling_night IS NOT NULL
     AND lower(trim(to_char(v_start_date, 'FMDay'))) IS DISTINCT FROM lower(trim(v_bowling_night)) THEN
    RAISE WARNING 'Season start_date weekday (%) != bowling_night (%) — bowled_at derivation and LaneTalk toMonday assume Monday; the import parser needs generalizing for this season',
      to_char(v_start_date, 'FMDay'), v_bowling_night;
  END IF;

  RETURN NEW;
END;
$function$
;


-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.activity_event_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER enqueue_event_broadcast AFTER INSERT ON public.activity_feed_events FOR EACH ROW EXECUTE FUNCTION enqueue_broadcast_for_activity_event();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.activity_feed_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.app_version_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.auction_bids FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.auction_house_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.auctions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_haunts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER bet_legs_no_self_tank BEFORE INSERT OR UPDATE ON public.bet_legs FOR EACH ROW EXECUTE FUNCTION prevent_self_tank();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_legs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_markets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_refund_bets_before_market_delete BEFORE DELETE ON public.bet_markets FOR EACH ROW EXECUTE FUNCTION refund_bets_before_market_delete();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_selections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bet_selections_fill_side BEFORE INSERT ON public.bet_selections FOR EACH ROW EXECUTE FUNCTION bet_selections_fill_side();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.board_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_hunter_stakes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_post FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bounty_settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcast_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcast_event_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcast_push_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.custom_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER games_participation_seed_ins AFTER INSERT ON public.games REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_seed_participation_games();

CREATE TRIGGER games_resync_markets_del AFTER DELETE ON public.games REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_games();

CREATE TRIGGER games_resync_markets_ins AFTER INSERT ON public.games REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_games();

CREATE TRIGGER games_resync_markets_upd AFTER UPDATE ON public.games REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_games();

CREATE TRIGGER games_same_week_check BEFORE INSERT OR UPDATE OF team_a_id, team_b_id ON public.games FOR EACH ROW EXECUTE FUNCTION games_same_week();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.item_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER lanetalk_import_stats BEFORE INSERT OR UPDATE OF payload ON public.lanetalk_game_imports FOR EACH ROW EXECUTE FUNCTION trg_lanetalk_import_stats();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lanetalk_game_imports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loan_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER loan_products_immutable_terms BEFORE UPDATE ON public.loan_products FOR EACH ROW EXECUTE FUNCTION prevent_loan_product_term_updates();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loan_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.odds_engine_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.odds_engine_stat_corr FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pin_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.player_inventory_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.playoff_draft_captains FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.playoff_draft_picks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.playoff_draft_pool FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.playoff_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.push_category_prefs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.push_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_challenge_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_challenges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pvp_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reset_recurring_last_fired BEFORE UPDATE ON public.recurring_broadcast_schedules FOR EACH ROW EXECUTE FUNCTION reset_recurring_schedule_last_fired();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.recurring_broadcast_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER rsvp_resync_markets_del AFTER DELETE ON public.rsvp REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_rsvp();

CREATE TRIGGER rsvp_resync_markets_ins AFTER INSERT ON public.rsvp REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_rsvp();

CREATE TRIGGER rsvp_resync_markets_upd AFTER UPDATE ON public.rsvp REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_rsvp();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rsvp FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rsvp_bonus_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER scores_resync_markets_del AFTER DELETE ON public.scores REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_scores();

CREATE TRIGGER scores_resync_markets_ins AFTER INSERT ON public.scores REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_scores();

CREATE TRIGGER scores_slot_in_game_check BEFORE INSERT OR UPDATE OF team_slot_id, game_id ON public.scores FOR EACH ROW EXECUTE FUNCTION scores_slot_in_game();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.season_champions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER prevent_non_open_season_delete BEFORE DELETE ON public.seasons FOR EACH ROW EXECUTE FUNCTION prevent_non_open_season_delete();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.team_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_slots_resync_markets_del AFTER DELETE ON public.team_slots REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_team_slots();

CREATE TRIGGER team_slots_resync_markets_ins AFTER INSERT ON public.team_slots REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_team_slots();

CREATE TRIGGER team_slots_resync_markets_upd AFTER UPDATE ON public.team_slots REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_resync_markets_team_slots();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.week_archive_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.week_archive_snapshot FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.weeks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER weeks_derive_bowled_at BEFORE INSERT ON public.weeks FOR EACH ROW EXECUTE FUNCTION weeks_derive_bowled_at();
