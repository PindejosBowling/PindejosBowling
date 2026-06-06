-- Rename existing "Season 1 champion bonus" ledger descriptions to "Season 1 Champion".
-- Applies to both the player-side and house-side (is_house = true) entries so the
-- description is identical on both sides of the double-entry ledger (the house side
-- drops its "House-funded: " prefix to match the player side exactly).

update pin_ledger
set description = 'Season 1 Champion'
where description in ('Season 1 champion bonus', 'House-funded: Season 1 champion bonus');
