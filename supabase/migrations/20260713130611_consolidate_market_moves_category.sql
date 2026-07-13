-- Consolidate the 'market_moves' broadcast category into 'pinsino': all Market
-- Moves are Pinsino activity by definition, so one mutable category covers both
-- admin-composed economy pushes and automated Market Moves pushes.
-- Defensive repoint first (live counts are zero today; category_id FKs have no
-- ON DELETE action, so any stray row would block the DELETE):
UPDATE public.broadcast_event_rules
   SET category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'pinsino')
 WHERE category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'market_moves');

UPDATE public.broadcasts
   SET category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'pinsino')
 WHERE category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'market_moves');

-- push_category_prefs rows (none exist) cascade-delete with the category.
DELETE FROM public.broadcast_categories WHERE key = 'market_moves';
