-- RSVP self-submit bonus — pin_ledger.type vocabulary extension.
-- ===========================================================================
-- Adds 'rsvp_bonus': a house-funded, week-stamped credit paid when a player
-- PERSONALLY submits their own RSVP for the week before the configurable
-- deadline (default 6:00pm on the bowl night). Written double-entry via
-- pin_ledger_double_entry (player +amount / house -amount), so the credit nets
-- to zero and the conservation invariant (SUM(amount) = SUM(score_credit))
-- holds — exactly like the generic 'bonus' type. A distinct type lets the
-- once-per-(player, week) idempotency guard key cleanly and keeps the award
-- separable in ledger/leaderboard display.
--
-- Drop + re-add the full array as last set by 20260623200500_ghost_in_the_slip.sql,
-- appending 'rsvp_bonus'.
ALTER TABLE public.pin_ledger DROP CONSTRAINT pin_ledger_type_check;
ALTER TABLE public.pin_ledger ADD CONSTRAINT pin_ledger_type_check
  CHECK ((type = ANY (ARRAY['bonus'::text, 'score_credit'::text, 'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text, 'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text, 'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text, 'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text, 'auction_purchase'::text, 'auction_check_bounce'::text, 'bet_insurance_refund'::text, 'bet_odds_boost'::text, 'bet_haunt_steal'::text, 'rsvp_bonus'::text])));
