-- Consolidate the 'reminders' broadcast category into 'league': a reminder is
-- just one kind of League Announcement, so one mutable category covers both.
-- The league description is widened to name reminders explicitly.
-- Defensive repoint first (live counts are zero today; category_id FKs have no
-- ON DELETE action, so any stray row would block the DELETE):
UPDATE public.broadcast_event_rules
   SET category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'league')
 WHERE category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'reminders');

UPDATE public.broadcasts
   SET category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'league')
 WHERE category_id = (SELECT id FROM public.broadcast_categories WHERE key = 'reminders');

-- push_category_prefs rows cascade-delete with the category (the sole live row
-- was an explicit enabled=true — identical to the absent-row default).
DELETE FROM public.broadcast_categories WHERE key = 'reminders';

UPDATE public.broadcast_categories
   SET description = 'Schedule changes, standings news, RSVP and bowl-night reminders, and other league-wide announcements.'
 WHERE key = 'league';
