-- Index the one remaining unindexed FK on the betting tables. bet_offers.accepted_by
-- → players(id) was missed by the target-model migration (the performance advisor
-- flags unindexed FKs). Peer betting is deferred, but the index is cheap and keeps
-- the advisor clean.
CREATE INDEX IF NOT EXISTS idx_bet_offers_accepted_by ON public.bet_offers (accepted_by);
