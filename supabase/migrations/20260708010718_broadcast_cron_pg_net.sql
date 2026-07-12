-- Push Broadcasts M3 — the per-minute scheduler tick (pg_cron + pg_net).
--
-- Scheduled broadcasts need something server-side to fire at scheduled_for
-- with no admin present. Same shape as the auction sweep (20260612200004):
-- a per-minute pg_cron job runs a zero-grant SECURITY DEFINER function. The
-- new piece is pg_net — the tick has to reach the send-broadcasts Edge
-- Function over HTTP (Expo's API can't be called from SQL sanely).
--
-- ⚠ ONE-TIME MANUAL STEP (run in the SQL editor; NEVER commit the values —
-- the auction_bid_amount_key precedent):
--   SELECT vault.create_secret('https://lyihsvxraurjghjqxaau.supabase.co', 'project_url');
--   SELECT vault.create_secret('<service_role_key>', 'service_role_key');
-- Rotating the service-role key requires vault.update_secret here too, or the
-- cron path 401s silently (check net._http_response for failures).

CREATE EXTENSION IF NOT EXISTS pg_net;

-- The tick. Cheap by design: one index probe against broadcasts_due_idx (and
-- the pending-receipt partial index) decides whether to make the HTTP call at
-- all — a quiet minute costs no network. Zero grants; owner (postgres, the
-- cron role) executes by ownership, so cron is its only caller.
CREATE FUNCTION public.invoke_broadcast_sender()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
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
$function$;

REVOKE ALL ON FUNCTION public.invoke_broadcast_sender() FROM PUBLIC, anon, authenticated;

-- Idempotent schedule: a replay must not stack duplicate jobs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send_broadcasts_every_minute') THEN
    PERFORM cron.schedule('send_broadcasts_every_minute', '* * * * *', 'SELECT public.invoke_broadcast_sender()');
  END IF;
END;
$$;
