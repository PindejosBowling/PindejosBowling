# Database Schema

Proposed Supabase (Postgres) schema for the Pindejos Bowling app.
Replaces the existing Google Sheets + Google Apps Script backend.

## Design Principles

- Stats (averages, standings, win/loss records) are computed via SQL views and queries — never stored redundantly
- `N` games per week is a runtime value, not a schema constraint
- Player identity is a stable UUID, not a mutable name string
- RSVP history is never deleted
- Auth is handled by Supabase Phone OTP; `players.id` mirrors `auth.users.id`

---

## Tables

### `players`

Master player registry. `id` is shared with Supabase Auth so RLS policies work without a join.

```sql
players
  id          uuid          PRIMARY KEY   -- mirrors auth.users.id
  name        text          NOT NULL UNIQUE
  phone       text          NOT NULL UNIQUE
  is_active   boolean       NOT NULL DEFAULT true
  created_at  timestamptz   NOT NULL DEFAULT now()
```

---

### `seasons`

One row per season. `ended_at IS NULL` identifies the active season.

```sql
seasons
  id            serial        PRIMARY KEY
  number        integer       NOT NULL UNIQUE
  league_name   text          NOT NULL
  bowling_night text          NOT NULL  -- e.g. "Tuesday"
  started_at    date          NOT NULL
  ended_at      date                    -- null = season is active
```

---

### `weeks`

One row per bowling night within a season.

```sql
weeks
  id            uuid          PRIMARY KEY
  season_id     integer       NOT NULL REFERENCES seasons(id)
  week_number   integer       NOT NULL
  bowled_at     date                    -- null = not yet bowled
  is_confirmed  boolean       NOT NULL DEFAULT false  -- matchups locked in
  is_archived   boolean       NOT NULL DEFAULT false  -- scores finalized

  UNIQUE (season_id, week_number)
```

---

### `rsvp`

Attendance per player per week. Rows are never deleted — full history is preserved.

```sql
rsvp
  id          uuid          PRIMARY KEY
  week_id     uuid          NOT NULL REFERENCES weeks(id)
  player_id   uuid          NOT NULL REFERENCES players(id)
  status      text          NOT NULL CHECK (status IN ('in', 'out'))
  note        text
  updated_at  timestamptz   NOT NULL DEFAULT now()

  UNIQUE (week_id, player_id)
```

---

### `team_slots`

Assigns players to teams for a given week. Separating this from `scores` is what
allows N games per week — a player's team assignment is recorded once regardless
of how many games are bowled that night.

`player_id` is nullable to support "League Avg Fill" placeholder slots.

```sql
team_slots
  id            uuid          PRIMARY KEY
  week_id       uuid          NOT NULL REFERENCES weeks(id)
  player_id     uuid          REFERENCES players(id)  -- null = fill slot
  team_number   integer       NOT NULL
  slot          integer       NOT NULL  -- position within team (0-indexed)
  is_fill       boolean       NOT NULL DEFAULT false

  UNIQUE (week_id, team_number, slot)
```

---

### `game_schedule`

Defines which teams face each other in each game round for a week.
`game_number` has no upper bound — adding more games is just more rows.

```sql
game_schedule
  id            uuid          PRIMARY KEY
  week_id       uuid          NOT NULL REFERENCES weeks(id)
  game_number   integer       NOT NULL  -- 1, 2, 3 ... N
  team_a        integer       NOT NULL
  team_b        integer       NOT NULL

  UNIQUE (week_id, game_number, team_a)
```

---

### `scores`

One row per player per game. References `team_slots` rather than `player_id`
directly so fill slots (null player) have a clean unique constraint.

`score` is nullable until the score is entered.

```sql
scores
  id            uuid          PRIMARY KEY
  team_slot_id  uuid          NOT NULL REFERENCES team_slots(id)
  game_number   integer       NOT NULL
  score         integer                 -- null = not yet entered
  updated_at    timestamptz   NOT NULL DEFAULT now()

  UNIQUE (team_slot_id, game_number)
```

---

### `board_posts`

Trash talk / social board.

```sql
board_posts
  id          uuid          PRIMARY KEY
  player_id   uuid          NOT NULL REFERENCES players(id)
  message     text          NOT NULL
  created_at  timestamptz   NOT NULL DEFAULT now()
```

---

### `season_champions`

Records the champion(s) declared at season end. Supports multiple champions
(e.g. tied or co-champions). Written by an admin action, not derived.

```sql
season_champions
  id          uuid          PRIMARY KEY
  season_id   integer       NOT NULL REFERENCES seasons(id)
  player_id   uuid          NOT NULL REFERENCES players(id)

  UNIQUE (season_id, player_id)
```

---

## Computed via SQL Views (not stored)

These replace all derived data that was previously written to Google Sheets.

| Stat | Source tables |
|---|---|
| Player average (season or all-time) | `scores`, `team_slots` |
| Season standings (wins, losses, pins) | `scores`, `team_slots`, `game_schedule` |
| Win/loss per game | Compare `SUM(score)` per team per game via `game_schedule` |
| High game | `MAX(score)` per player from `scores` |
| High series | `SUM(score)` grouped by player + week |
| Attendance rate | `rsvp` status counts per player |
| Head-to-head record | `team_slots` joined across two players in same week + different teams |
| Chemistry (win rate by partner) | `team_slots` rows sharing same `week_id` + `team_number` |

---

## What this replaces from the current Google Sheets model

| Old sheet | Replaced by |
|---|---|
| Roster Avgs | `players` + computed averages |
| Weekly RSVP | `rsvp` (with full history) |
| Generated Teams | `team_slots` |
| Active Week | `team_slots` + `scores` + `game_schedule` |
| Current Week (legacy) | Fully retired |
| Weekly Scores | `scores` (raw) + SQL views (derived) |
| League History | `seasons` |
| Season Champions | `season_champions` |
| Trash Board | `board_posts` |
| Settings | `seasons` columns + app config |

---

## Auth Integration (Supabase)

- Login: phone number + SMS OTP via Supabase Auth
- `players.id` = `auth.users.id` — no join required for RLS
- Row Level Security enforces that players can only write their own `rsvp` rows
- Admin operations (confirm matchups, archive week, end season) gated by a role or flag on `players`
