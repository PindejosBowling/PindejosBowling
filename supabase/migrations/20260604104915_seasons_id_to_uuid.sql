-- Convert seasons.id and its FK references from integer/sequence to uuid.
-- Aligns seasons with every other table (all uuid / gen_random_uuid) and removes
-- the only sequence in the schema, fixing "permission denied for sequence
-- seasons_id_seq" on admin season inserts (authenticated lacked USAGE on it).

-- 1. New uuid surrogate on seasons + temp mapping columns on child tables.
ALTER TABLE seasons ADD COLUMN new_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE weeks            ADD COLUMN new_season_id uuid;
ALTER TABLE registrations    ADD COLUMN new_season_id uuid;
ALTER TABLE season_champions ADD COLUMN new_season_id uuid;

-- 2. Backfill child references through the old integer id.
UPDATE weeks            c SET new_season_id = s.new_id FROM seasons s WHERE c.season_id = s.id;
UPDATE registrations    c SET new_season_id = s.new_id FROM seasons s WHERE c.season_id = s.id;
UPDATE season_champions c SET new_season_id = s.new_id FROM seasons s WHERE c.season_id = s.id;

-- 3. Drop old FK constraints (they reference the integer seasons.id).
ALTER TABLE weeks            DROP CONSTRAINT weeks_season_id_fkey;
ALTER TABLE registrations    DROP CONSTRAINT registrations_season_id_fkey;
ALTER TABLE season_champions DROP CONSTRAINT season_champions_season_id_fkey;

-- 4. Swap each child's season_id to the uuid column. Dropping the integer column
--    also drops the composite unique constraints / index that include season_id;
--    they are recreated in step 6.
ALTER TABLE weeks            DROP COLUMN season_id;
ALTER TABLE weeks            RENAME COLUMN new_season_id TO season_id;
ALTER TABLE weeks            ALTER COLUMN season_id SET NOT NULL;

ALTER TABLE registrations    DROP COLUMN season_id;
ALTER TABLE registrations    RENAME COLUMN new_season_id TO season_id;
ALTER TABLE registrations    ALTER COLUMN season_id SET NOT NULL;

ALTER TABLE season_champions DROP COLUMN season_id;
ALTER TABLE season_champions RENAME COLUMN new_season_id TO season_id;
ALTER TABLE season_champions ALTER COLUMN season_id SET NOT NULL;

-- 5. Swap seasons PK to the uuid column. Dropping the old id column also drops
--    the owned sequence seasons_id_seq.
ALTER TABLE seasons DROP CONSTRAINT seasons_pkey;
ALTER TABLE seasons DROP COLUMN id;
ALTER TABLE seasons RENAME COLUMN new_id TO id;
ALTER TABLE seasons ADD PRIMARY KEY (id);

-- 6. Recreate FK constraints (original on-delete behavior) and the composite
--    uniques / index that were dropped with the old season_id columns.
ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES seasons(id);
ALTER TABLE weeks ADD CONSTRAINT weeks_season_id_week_number_key
  UNIQUE (season_id, week_number);

ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE registrations ADD CONSTRAINT registrations_season_id_player_id_key
  UNIQUE (season_id, player_id);
CREATE INDEX registrations_season_id_idx ON registrations (season_id);

ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES seasons(id);
ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_id_player_id_key
  UNIQUE (season_id, player_id);

-- 7. Ensure the sequence is gone (auto-dropped with the old id column).
DROP SEQUENCE IF EXISTS seasons_id_seq;
