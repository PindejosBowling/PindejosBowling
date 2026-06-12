-- Copy tweak: "stake" → "wager" in the Golden Ticket pitch. Data-only update
-- to a cosmetic catalog column — no RPC touched, so no probe runs required.

UPDATE public.item_catalog
   SET description = 'The House can''t touch this one. Win and it pays; lose and your wager walks back to you. One use — spent the moment you attach it to a bet.',
       updated_at  = now()
 WHERE key = 'golden_ticket';
