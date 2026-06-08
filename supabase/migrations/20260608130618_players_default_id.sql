-- players.id never received a DEFAULT (legacy: it once mirrored auth.users.id, but
-- auth is now linked via players.user_id). Align it with every other table so callers
-- need not generate a uuid client-side.
alter table public.players alter column id set default gen_random_uuid();
