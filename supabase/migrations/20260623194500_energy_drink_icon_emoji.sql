-- Use the emoji-presentation lightning bolt (U+26A1 U+FE0F) for the Energy Drink
-- so it renders as the colored emoji rather than a monochrome text glyph. icon is
-- a mutable catalog column (no functional meaning), so a plain UPDATE is correct —
-- no new key / instance migration needed.
UPDATE public.item_catalog
   SET icon = '⚡️',
       updated_at = now()
 WHERE key = 'energy_drink';
