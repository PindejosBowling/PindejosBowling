-- Silent Auctions M4 — pg_cron + the per-minute sweep (FINDINGS §3).
--
-- The project's first scheduled job. The hammer falls at closes_at without an
-- admin present: sweep_auctions() opens due scheduled auctions and settles due
-- open ones (per-auction error isolation inside the function — see M3).
-- Job runs execute as the scheduling role (postgres), which holds EXECUTE by
-- ownership; sweep_auctions has no grants, so cron is its only caller.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent schedule: re-running this migration (or a db reset replay) must
-- not stack duplicate jobs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep_auctions_every_minute') THEN
    PERFORM cron.schedule('sweep_auctions_every_minute', '* * * * *', 'SELECT public.sweep_auctions()');
  END IF;
END;
$$;
