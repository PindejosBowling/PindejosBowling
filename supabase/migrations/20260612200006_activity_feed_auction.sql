-- Silent Auctions M6 — Activity Feed extension (FINDINGS §6; activity-feed.md
-- Recipe B, post-activity_event_catalog; the PvP feed migration is the shape
-- template).
--
-- Auction feed events carry week_id = NULL (auctions are week-agnostic
-- entities; the feed orders by occurred_at) — which also keeps them outside
-- unarchive_week's week-scoped feed delete, matching the money's independence.
--
-- One deviation from the recipe's standard single dedup index: bounces are
-- legitimately multiple per auction, so the dedup is SPLIT — one index for the
-- one-shot events, one keyed by actor for bounces.

-- 1. Source FK column + indexes.
ALTER TABLE public.activity_feed_events
  ADD COLUMN auction_id uuid REFERENCES public.auctions(id) ON DELETE CASCADE;

CREATE INDEX activity_feed_events_auction_idx
  ON public.activity_feed_events (auction_id) WHERE auction_id IS NOT NULL;

CREATE UNIQUE INDEX activity_feed_unique_auction_event
  ON public.activity_feed_events (auction_id, event_type)
  WHERE auction_id IS NOT NULL AND event_type <> 'auction_check_bounce';

CREATE UNIQUE INDEX activity_feed_unique_auction_bounce
  ON public.activity_feed_events (auction_id, event_type, actor_player_id)
  WHERE auction_id IS NOT NULL AND event_type = 'auction_check_bounce';

-- 2. One-source + source-feature CHECKs gain the auction terms.
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_one_source_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_one_source_check
  CHECK (((((((sportsbook_bet_id IS NOT NULL))::integer
           + ((loan_id IS NOT NULL))::integer)
           + ((pvp_challenge_id IS NOT NULL))::integer)
           + ((bounty_post_id IS NOT NULL))::integer)
           + ((auction_id IS NOT NULL))::integer) <= 1);

ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_source_feature_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check
  CHECK ((source_feature = ANY (ARRAY['sportsbook'::text, 'loan_shark'::text, 'pvp'::text,
                                      'bounty_board'::text, 'auction_house'::text,
                                      'system'::text, 'admin'::text])));

-- 3. Catalog: extend allowed_fk + register the core four. (No event_type CHECK
--    exists anymore — the FK into the catalog accepts these automatically.)
ALTER TABLE public.activity_event_catalog DROP CONSTRAINT activity_event_catalog_allowed_fk_check;
ALTER TABLE public.activity_event_catalog ADD CONSTRAINT activity_event_catalog_allowed_fk_check
  CHECK (allowed_fk IN ('sportsbook_bet_id', 'loan_id', 'pvp_challenge_id',
                        'bounty_post_id', 'auction_id', 'none'));

INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility) VALUES
  ('auction_opened',       'auction_house', 'auction_house.opened',       false, 'auction_id', 'public'),
  ('auction_won',          'auction_house', 'auction_house.won',          true,  'auction_id', 'public'),
  ('auction_check_bounce', 'auction_house', 'auction_house.check_bounce', true,  'auction_id', 'public'),
  ('auction_no_sale',      'auction_house', 'auction_house.no_sale',      false, 'auction_id', 'public');

-- 4. publish_activity_event: 16 → 17 args (trailing defaulted p_auction_id).
--    Postgres can't CREATE OR REPLACE across a signature change: DROP +
--    recreate. The function holds no client grants (deny-by-default; called
--    only from SECURITY DEFINER publishers), so there is nothing to re-grant.

DROP FUNCTION public.publish_activity_event(text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, timestamptz, uuid, uuid);

CREATE FUNCTION public.publish_activity_event(
  p_source_feature text, p_event_type text, p_season_id uuid, p_week_id uuid,
  p_actor_player_id uuid, p_subject_player_id uuid, p_secondary_player_id uuid,
  p_sportsbook_bet_id uuid, p_loan_id uuid, p_template_key text,
  p_public_payload jsonb, p_admin_payload jsonb, p_visibility text,
  p_occurred_at timestamptz,
  p_pvp_challenge_id uuid DEFAULT NULL,
  p_bounty_post_id uuid DEFAULT NULL,
  p_auction_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
$function$;

-- 5. Recreate the two publishers with their feed calls (the M3 bodies carried
--    "M6: publish here" markers; this is that step).

CREATE OR REPLACE FUNCTION public.open_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction   public.auctions;
  v_item_name text;
  v_item_icon text;
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

  PERFORM public.publish_activity_event(
    'auction_house', 'auction_opened',
    v_auction.season_id, NULL, NULL, NULL, NULL,
    NULL, NULL,
    'auction_house.opened',
    jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                       'minimum_bid', v_auction.minimum_bid, 'closes_at', v_auction.closes_at),
    jsonb_build_object('auction_id', p_auction_id),
    NULL, now(),
    NULL, NULL, p_auction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
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
  v_won          boolean := false;
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
  -- accuracy; the archive engine is auction-exempt — see M3's unarchive edit).
  SELECT id INTO v_week
    FROM public.weeks WHERE season_id = v_auction.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  SELECT count(*) INTO v_bidder_count
    FROM public.auction_bids WHERE auction_id = p_auction_id AND status = 'active';

  -- Rank: first-price, ties to whoever held their amount longest.
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

      UPDATE public.auctions
         SET winner_player_id = v_bid.player_id,
             winning_bid_id   = v_bid.id,
             winning_price    = v_bid.amount
       WHERE id = p_auction_id;

      PERFORM public.publish_activity_event(
        'auction_house', 'auction_won',
        v_auction.season_id, NULL, v_bid.player_id, NULL, NULL,
        NULL, NULL,
        'auction_house.won',
        jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                           'price', v_bid.amount),
        jsonb_build_object('auction_id', p_auction_id),
        NULL, now(),
        NULL, NULL, p_auction_id);

      v_won := true;
      EXIT;
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
        v_auction.season_id, NULL, v_bid.player_id, NULL, NULL,
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

  IF NOT v_won THEN
    -- No-sale. Payload carries the counts (the rows are gone) — the app
    -- template special-cases bounce_count = bidder_count > 0 with the
    -- "every single pledge bounced" copy.
    PERFORM public.publish_activity_event(
      'auction_house', 'auction_no_sale',
      v_auction.season_id, NULL, NULL, NULL, NULL,
      NULL, NULL,
      'auction_house.no_sale',
      jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                         'bidder_count', v_bidder_count, 'bounce_count', v_bounce_count),
      jsonb_build_object('auction_id', p_auction_id),
      NULL, now(),
      NULL, NULL, p_auction_id);
  END IF;
END;
$$;
