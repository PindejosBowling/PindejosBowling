-- One-off data fix: a Lanetalk link for Andre Simoneau carried a misspelled
-- handle ("...PBLL" instead of "...PBL"), so the importer resolved the week but
-- matched no player, leaving the game classified Recreational with a null
-- player_id. His night spans two links; the other already gave him official
-- game 2 (105), and this link's single game (89) matches his recorded official
-- game-1 score (89). Assign it to him as official game 1.
--
-- week:  6c317b4d-ccbc-4f6c-92a9-18a916c37509
-- player: fab3cb61-90f6-459f-905c-206ea35a398d (Andre Simoneau)
-- slot:   b7fa0811-3da5-417e-aa69-87d702eec20d
-- row:    24bd42c8-86b5-4545-b0dd-43478564bf4a (source 6be6285f…, score 89)
update public.lanetalk_game_imports
set player_id      = 'fab3cb61-90f6-459f-905c-206ea35a398d',
    team_slot_id   = 'b7fa0811-3da5-417e-aa69-87d702eec20d',
    classification = 'official',
    payload        = payload || jsonb_build_object(
                       'player_id', 'fab3cb61-90f6-459f-905c-206ea35a398d',
                       'team_slot_id', 'b7fa0811-3da5-417e-aa69-87d702eec20d',
                       'classification', 'official'
                     )
where id = '24bd42c8-86b5-4545-b0dd-43478564bf4a'
  and player_id is null;
