-- Rename the broadcast category 'economy' → 'pinsino' (key AND label),
-- standardizing on the "Pinsino" name across the stack. Everything downstream
-- (push_category_prefs, broadcasts, the send-broadcasts Edge Function payload)
-- references the category by uuid id — the key is display/routing data only —
-- so a data update is the whole rename. Description unchanged.
-- broadcast_categories is a read-only catalog: edits are migrations.

UPDATE public.broadcast_categories
SET key = 'pinsino', label = 'Pinsino'
WHERE key = 'economy';
