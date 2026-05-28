# ETL: Google Sheets → Supabase

Migrates all historical bowling data from `Super Pindejos Bowling League.xlsx` into the Supabase schema defined in `SCHEMA.md`. All 9 migrations have already been applied.

---

## Source File

`Super Pindejos Bowling League.xlsx` — 12 sheets, parsed using Python stdlib (`zipfile` + `xml.etree.ElementTree`). No external packages required.

### Sheets and what they produce

| Sheet | Sheet# | Produces |
|---|---|---|
| Settings | 2 | `seasons` metadata |
| Roster Avgs | 6 | `players` |
| Weekly Scores | 8 | `weeks`, `team_slots`, `game_schedule`, `scores` |
| Season Champions | 12 | `season_champions` |
| Trash Board | 10 | `board_posts` (skipped — see below) |
| Weekly RSVP | 9 | skipped (empty) |
| Admin | 1 | skipped (fee tracking only) |
| Generated Teams | 5 | skipped (upcoming week, not yet bowled) |
| Active Week | 3 | skipped (empty template) |
| Standings | 4 | skipped (computed, not stored) |
| Current Week | 7 | skipped (legacy sheet) |
| League History | 11 | skipped (computed aggregates, use Weekly Scores instead) |

---

## Players (13)

From **Roster Avgs** (sheet 6), column A (skip header row):

```
Garrett, John, Andre, Jack, Brandtly, Danny, Jordan, Daniel, Thomas, Nick, CJ, Troy, Hayden
```

**Schema constraints:**
- `id`: Generate a fresh UUID4 per player. These are NOT yet tied to `auth.users` — that mapping happens when phone OTP auth is set up.
- `phone`: NOT NULL UNIQUE in schema, but no phone data exists in the spreadsheet. Use sequential placeholders: `+15550000001` through `+15550000013`. Must be updated before production.
- `is_active`: `true` for all.

---

## Seasons (2)

From **Settings** (sheet 2) + inference:

| Field | Season 1 | Season 2 |
|---|---|---|
| `number` | `1` | `2` |
| `league_name` | `'Pindejos Bowling'` | `'Pindejos Bowling'` |
| `bowling_night` | `'Tuesday'` | `'Tuesday'` |
| `started_at` | `'2025-09-01'` *(placeholder)* | `'2026-01-01'` *(placeholder)* |
| `ended_at` | `'2026-01-01'` *(placeholder)* | `NULL` *(active season)* |

---

## Weeks (11 total)

From unique `(Season, Week)` combinations in **Weekly Scores** (sheet 8):

| Season | Week column value | `week_number` | Notes |
|---|---|---|---|
| 1 | 1–7 | 1–7 | Regular weeks |
| 1 | `'Playoffs'` | `8` | Map string → integer 8 |
| 2 | 1–3 | 1–3 | Completed weeks |

All historical weeks: `is_confirmed = true`, `is_archived = true`, `bowled_at = NULL` (no date data in source).

---

## Weekly Scores Sheet Structure

Headers: `Season, Week, Player, Team, Game 1, Game 1 Opp, Game 2, Game 2 Opp, Total Pins, Total Wins, Total Losses, Total Games, Present`

- **Season** (col A): float → cast to int (1 or 2)
- **Week** (col B): float or string `'Playoffs'`
- **Player** (col C): player name string
- **Team** (col D): `'Team N'` → parse N as integer
- **Game 1** (col E): integer score, or float league-avg fill score
- **Game 1 Opp** (col F): opponent team name string `'Team N'` → parse N
- **Game 2** (col G): integer score, or None (some playoff rows have only 1 game)
- **Game 2 Opp** (col H): opponent team name, or None
- **Present** (col M): boolean — `False` means player was absent (fill slot)

**109 data rows** total (excluding header).

---

## team_slots

One row per data row in Weekly Scores.

| Source | Target |
|---|---|
| `(Season, Week)` → week UUID | `week_id` |
| Player name → player UUID | `player_id` (NULL if `Present=False`) |
| `'Team N'` → N | `team_number` |
| 0-indexed order of appearance within `(week, team_number)` | `slot` |
| `Present=False` | `is_fill=TRUE`, `player_id=NULL` |
| `Present=True` | `is_fill=FALSE`, `player_id=<uuid>` |

**Slot assignment:** group rows by `(season, week, team_number)`, sort by order of appearance in the sheet, assign `slot = 0, 1, 2, ...`

---

## game_schedule

Reconstructed from the opponent columns in Weekly Scores. For each `(week_id, game_number)`, collect all `(player_team, opp_team)` pairs and deduplicate into canonical matchup rows.

**Deduplication rule:** normalize each pair as `(min(a,b), max(a,b))` to avoid inserting both `(1,2)` and `(2,1)` for the same matchup.

**Game 1** uses cols F (`Game 1 Opp`). **Game 2** uses cols H (`Game 2 Opp`). Skip rows where the opp column is None.

**Expected output:**
- 4-team weeks (S1 W1–W5): 2 matchups × 2 games = 4 rows per week
- 2-team weeks (S1 W6–W7, all S2 weeks): 1 matchup × 2 games = 2 rows per week
- Playoffs: variable (some teams had only 1 game)

---

## scores

One row per non-null score. For each team_slot row:
- If `Game 1` score is not None → insert `(team_slot_id, game_number=1, score=int(Game1))`
- If `Game 2` score is not None → insert `(team_slot_id, game_number=2, score=int(Game2))`

Cast float scores to int (league-avg fill scores are floats like `111.1`).

---

## season_champions

From **Season Champions** (sheet 12), rows 2–4:

| `season_id` | Player |
|---|---|
| 1 | CJ |
| 1 | Troy |
| 1 | Nick |

---

## board_posts — SKIPPED

All 5 posts have authors not present in the players table:
- `Anonymous` × 2: "Javer kind of smells a little"
- `KINGNGL` × 1: "Bouta go Brooklyn on yo ass"
- `Paige` × 2: "Jordan's ass at bowling"

`board_posts.player_id` is NOT NULL with a FK to `players`. These posts cannot be inserted without either adding these people as players or making `player_id` nullable. Skip for now.

---

## Excel Date Parsing

The shared strings in the xlsx are accessed via `xl/sharedStrings.xml`. Cell values with type `t='s'` are indices into this array. Dates in the Trash Board are stored as Excel serial numbers (days since 1899-12-30). Convert with:

```python
from datetime import datetime, timedelta
def excel_date(serial):
    return datetime(1899, 12, 30) + timedelta(days=serial)
```

---

## Execution Steps

### 1. Write `scripts/etl.py`

Python script using only stdlib. Structure:

```python
import zipfile, xml.etree.ElementTree as ET, uuid, json
from datetime import datetime, timedelta

XLSX = 'Super Pindejos Bowling League.xlsx'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

# --- helpers: get_shared_strings(), get_cell_value(), parse_sheet() ---
# (same approach used to explore this file — already confirmed working)

# Step 1: parse all sheets into raw row lists
# Step 2: build entity dicts (players, seasons, weeks, team_slots, game_schedule, scores, champions)
# Step 3: write scripts/seed_data.sql
```

Use `INSERT INTO ... VALUES (...) ON CONFLICT DO NOTHING;` for every statement so the script is safely re-runnable.

### 2. Run `scripts/etl.py`

```bash
cd /Users/garrett/Code/PindejosBowling
python3 scripts/etl.py
# produces scripts/seed_data.sql
```

### 3. Apply SQL via Supabase MCP `execute_sql`

Wrap the seed SQL in a RLS disable/enable block:

```sql
-- Disable RLS temporarily for bulk insert
ALTER TABLE players       DISABLE ROW LEVEL SECURITY;
ALTER TABLE seasons       DISABLE ROW LEVEL SECURITY;
ALTER TABLE weeks         DISABLE ROW LEVEL SECURITY;
ALTER TABLE rsvp          DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_slots    DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_schedule DISABLE ROW LEVEL SECURITY;
ALTER TABLE scores        DISABLE ROW LEVEL SECURITY;
ALTER TABLE board_posts   DISABLE ROW LEVEL SECURITY;
ALTER TABLE season_champions DISABLE ROW LEVEL SECURITY;

-- INSERT statements here (from seed_data.sql)

-- Re-enable RLS
ALTER TABLE players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE weeks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvp          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_slots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_champions ENABLE ROW LEVEL SECURITY;
```

Split into multiple `execute_sql` calls if the payload is too large (insert tables one at a time between the RLS toggles if needed).

---

## Verification Queries

Run these after loading to confirm data integrity:

```sql
-- Row counts
SELECT 'players' AS t, count(*) FROM players
UNION ALL SELECT 'seasons', count(*) FROM seasons
UNION ALL SELECT 'weeks', count(*) FROM weeks
UNION ALL SELECT 'team_slots', count(*) FROM team_slots
UNION ALL SELECT 'game_schedule', count(*) FROM game_schedule
UNION ALL SELECT 'scores', count(*) FROM scores
UNION ALL SELECT 'season_champions', count(*) FROM season_champions;
-- Expected: 13, 2, 11, 109, ~28, ~200, 3

-- Spot-check player game counts (should match Roster Avgs sheet)
SELECT p.name, count(s.id) AS games_played
FROM players p
JOIN team_slots ts ON ts.player_id = p.id
JOIN scores s ON s.team_slot_id = ts.id
GROUP BY p.name ORDER BY p.name;

-- Confirm Season 2 is still active (ended_at IS NULL)
SELECT number, ended_at FROM seasons ORDER BY number;

-- Confirm season_champions
SELECT s.number, p.name
FROM season_champions sc
JOIN seasons s ON s.id = sc.season_id
JOIN players p ON p.id = sc.player_id;
```

---

## Post-ETL TODOs

- Update `players.phone` with real phone numbers before enabling auth
- Update `seasons.started_at` / `seasons.ended_at` with actual dates
- Write RLS policies (currently enabled but no policies exist — all access is blocked for non-postgres roles)
- Map `players.id` to `auth.users.id` after users sign up via phone OTP
