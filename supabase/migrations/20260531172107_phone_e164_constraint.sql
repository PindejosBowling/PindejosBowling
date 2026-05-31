-- Fix any empty-string phone values before adding the constraint
UPDATE public.players SET phone = NULL WHERE phone = '';

-- Allow phone to be NULL (players without a number on file)
ALTER TABLE public.players ALTER COLUMN phone DROP NOT NULL;

-- Enforce E.164 format (+[country][number], 7–15 digits) when phone is present
ALTER TABLE public.players
  ADD CONSTRAINT players_phone_e164
  CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{6,14}$');
