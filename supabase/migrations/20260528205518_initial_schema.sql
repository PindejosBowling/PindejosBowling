-- Players: master registry; id mirrors auth.users.id for RLS
CREATE TABLE players (
  id          uuid          PRIMARY KEY,
  name        text          NOT NULL UNIQUE,
  phone       text          NOT NULL UNIQUE,
  is_active   boolean       NOT NULL DEFAULT true,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

-- Seasons: one row per season; ended_at IS NULL = active season
CREATE TABLE seasons (
  id            serial        PRIMARY KEY,
  number        integer       NOT NULL UNIQUE,
  league_name   text          NOT NULL,
  bowling_night text          NOT NULL,
  started_at    date          NOT NULL,
  ended_at      date
);

-- Weeks: one bowling night per season
CREATE TABLE weeks (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     integer       NOT NULL REFERENCES seasons(id),
  week_number   integer       NOT NULL,
  bowled_at     date,
  is_confirmed  boolean       NOT NULL DEFAULT false,
  is_archived   boolean       NOT NULL DEFAULT false,

  UNIQUE (season_id, week_number)
);

-- RSVP: attendance history, never deleted
CREATE TABLE rsvp (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id     uuid          NOT NULL REFERENCES weeks(id),
  player_id   uuid          NOT NULL REFERENCES players(id),
  status      text          NOT NULL CHECK (status IN ('in', 'out')),
  note        text,
  updated_at  timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (week_id, player_id)
);

-- Team slots: player-to-team assignment for a week; null player_id = fill slot
CREATE TABLE team_slots (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id       uuid          NOT NULL REFERENCES weeks(id),
  player_id     uuid          REFERENCES players(id),
  team_number   integer       NOT NULL,
  slot          integer       NOT NULL,
  is_fill       boolean       NOT NULL DEFAULT false,

  UNIQUE (week_id, team_number, slot)
);

-- Game schedule: which teams face each other per game round
CREATE TABLE game_schedule (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id       uuid          NOT NULL REFERENCES weeks(id),
  game_number   integer       NOT NULL,
  team_a        integer       NOT NULL,
  team_b        integer       NOT NULL,

  UNIQUE (week_id, game_number, team_a)
);

-- Scores: one row per player per game; score nullable until entered
CREATE TABLE scores (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  team_slot_id  uuid          NOT NULL REFERENCES team_slots(id),
  game_number   integer       NOT NULL,
  score         integer,
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (team_slot_id, game_number)
);

-- Board posts: trash talk / social board
CREATE TABLE board_posts (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid          NOT NULL REFERENCES players(id),
  message     text          NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

-- Season champions: written by admin at season end; supports co-champions
CREATE TABLE season_champions (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   integer       NOT NULL REFERENCES seasons(id),
  player_id   uuid          NOT NULL REFERENCES players(id),

  UNIQUE (season_id, player_id)
);
