-- Copy tweak: "House" → "Sportsbook" in the Golden Ticket pitch (the item is
-- applied in the Sportsbook, so the pitch names the venue). Data-only update
-- to a cosmetic catalog column — no RPC touched, so no probe runs required.

UPDATE public.item_catalog
   SET description = 'The Sportsbook can''t touch this one. Win and it pays; lose and your wager walks back to you. One use — spent the moment you attach it to a bet.',
       updated_at  = now()
 WHERE key = 'golden_ticket';
