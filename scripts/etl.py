import zipfile
import xml.etree.ElementTree as ET
import uuid
import json
from datetime import datetime, timedelta

XLSX = '/Users/garrett/Code/PindejosBowling/Super Pindejos Bowling League.xlsx'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
OUT = '/Users/garrett/Code/PindejosBowling/scripts/seed_data.sql'


def get_shared_strings(zf):
    with zf.open('xl/sharedStrings.xml') as f:
        tree = ET.parse(f)
    root = tree.getroot()
    strings = []
    for si in root.findall(f'{{{NS}}}si'):
        parts = []
        for t in si.iter(f'{{{NS}}}t'):
            if t.text:
                parts.append(t.text)
        strings.append(''.join(parts))
    return strings


def col_letter_to_index(col):
    idx = 0
    for c in col:
        idx = idx * 26 + (ord(c.upper()) - ord('A') + 1)
    return idx - 1


def get_cell_value(cell, shared_strings):
    t = cell.get('t', '')
    v_el = cell.find(f'{{{NS}}}v')
    if v_el is None:
        return None
    val = v_el.text
    if t == 's':
        return shared_strings[int(val)]
    try:
        f = float(val)
        if f == int(f):
            return int(f)
        return f
    except (ValueError, TypeError):
        return val


def parse_sheet(zf, sheet_path, shared_strings):
    with zf.open(sheet_path) as f:
        tree = ET.parse(f)
    root = tree.getroot()
    sheet_data = root.find(f'{{{NS}}}sheetData')
    rows = []
    for row_el in sheet_data.findall(f'{{{NS}}}row'):
        row = {}
        for cell in row_el.findall(f'{{{NS}}}c'):
            ref = cell.get('r', '')
            col_str = ''.join(c for c in ref if c.isalpha())
            col_idx = col_letter_to_index(col_str)
            row[col_idx] = get_cell_value(cell, shared_strings)
        rows.append(row)
    return rows


def q(val):
    if val is None:
        return 'NULL'
    if isinstance(val, bool):
        return 'TRUE' if val else 'FALSE'
    if isinstance(val, (int, float)):
        return str(val)
    return "'" + str(val).replace("'", "''") + "'"


def main():
    with zipfile.ZipFile(XLSX) as zf:
        names = zf.namelist()
        print("Files in xlsx:", [n for n in names if n.startswith('xl/worksheets')])

        shared_strings = get_shared_strings(zf)

        # Find sheet paths by workbook
        with zf.open('xl/workbook.xml') as f:
            wb_tree = ET.parse(f)
        wb_root = wb_tree.getroot()
        wb_ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        rel_ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

        sheets_el = wb_root.find(f'{{{wb_ns}}}sheets')
        sheet_info = []
        for sh in sheets_el.findall(f'{{{wb_ns}}}sheet'):
            sheet_info.append({
                'name': sh.get('name'),
                'sheetId': sh.get('sheetId'),
                'rId': sh.get(f'{{{rel_ns}}}id'),
            })

        # Load relationships to map rId -> file
        with zf.open('xl/_rels/workbook.xml.rels') as f:
            rels_tree = ET.parse(f)
        rels_root = rels_tree.getroot()
        rel_map = {}
        for rel in rels_root:
            rel_map[rel.get('Id')] = rel.get('Target')

        sheet_by_name = {}
        for sh in sheet_info:
            target = rel_map.get(sh['rId'], '')
            path = 'xl/' + target if not target.startswith('xl/') else target
            sheet_by_name[sh['name']] = path
            print(f"  Sheet '{sh['name']}' -> {path}")

        roster_rows = parse_sheet(zf, sheet_by_name['Roster Avgs'], shared_strings)
        weekly_rows = parse_sheet(zf, sheet_by_name['Weekly Scores'], shared_strings)
        champions_rows = parse_sheet(zf, sheet_by_name['Season Champions'], shared_strings)

    # --- Players ---
    # Col A (index 0), skip header row
    player_names = []
    for row in roster_rows[1:]:
        name = row.get(0)
        if name and isinstance(name, str) and name.strip():
            player_names.append(name.strip())

    print(f"\nPlayers ({len(player_names)}): {player_names}")

    players = {}
    for i, name in enumerate(player_names):
        players[name] = {
            'id': str(uuid.uuid4()),
            'name': name,
            'phone': f'+1555000{i+1:04d}',
            'is_active': True,
        }

    # --- Seasons ---
    seasons = {
        1: {'id': 1, 'number': 1, 'league_name': 'Pindejos Bowling', 'bowling_night': 'Tuesday',
            'started_at': '2025-09-01', 'ended_at': '2026-01-01'},
        2: {'id': 2, 'number': 2, 'league_name': 'Pindejos Bowling', 'bowling_night': 'Tuesday',
            'started_at': '2026-01-01', 'ended_at': None},
    }

    # --- Parse Weekly Scores ---
    # Headers: Season(A=0), Week(B=1), Player(C=2), Team(D=3),
    #          Game1(E=4), Game1Opp(F=5), Game2(G=6), Game2Opp(H=7),
    #          TotalPins(I=8), TotalWins(J=9), TotalLosses(K=10), TotalGames(L=11), Present(M=12)
    data_rows = []
    for row in weekly_rows[1:]:  # skip header
        if not row:
            continue
        season_val = row.get(0)
        if season_val is None:
            continue
        season_num = int(float(season_val))

        week_val = row.get(1)
        if week_val is None:
            continue
        if isinstance(week_val, str) and week_val.strip().lower() == 'playoffs':
            week_num = 8
        else:
            week_num = int(float(week_val))

        player_name = row.get(2)
        if player_name:
            player_name = str(player_name).strip()

        team_val = row.get(3)
        team_num = None
        if team_val:
            s = str(team_val).strip()
            if s.startswith('Team '):
                team_num = int(s.split()[1])
            else:
                try:
                    team_num = int(s)
                except ValueError:
                    pass

        game1 = row.get(4)
        game1_opp_val = row.get(5)
        game2 = row.get(6)
        game2_opp_val = row.get(7)
        present_val = row.get(12)

        # Parse opp team numbers
        def parse_team(v):
            if v is None:
                return None
            s = str(v).strip()
            if s.startswith('Team '):
                return int(s.split()[1])
            try:
                return int(s)
            except ValueError:
                return None

        game1_opp = parse_team(game1_opp_val)
        game2_opp = parse_team(game2_opp_val)

        # Present: stored as int 0/1 or bool
        if present_val is None or present_val == '' or present_val == 0 or present_val is False:
            is_present = False
        elif present_val == 1 or present_val is True:
            is_present = True
        elif isinstance(present_val, str):
            is_present = present_val.strip().upper() not in ('FALSE', '0', 'NO', '')
        else:
            is_present = bool(present_val)

        data_rows.append({
            'season': season_num,
            'week': week_num,
            'player': player_name,
            'team': team_num,
            'game1': game1,
            'game1_opp': game1_opp,
            'game2': game2,
            'game2_opp': game2_opp,
            'present': is_present,
        })

    print(f"\nData rows: {len(data_rows)}")

    # --- Weeks ---
    seen_weeks = {}
    for dr in data_rows:
        key = (dr['season'], dr['week'])
        if key not in seen_weeks:
            seen_weeks[key] = str(uuid.uuid4())

    weeks = []
    for (season_num, week_num), week_id in sorted(seen_weeks.items()):
        weeks.append({
            'id': week_id,
            'season_id': season_num,
            'week_number': week_num,
            'bowled_at': None,
            'is_confirmed': True,
            'is_archived': True,
        })

    print(f"Weeks: {len(weeks)}")

    # --- Team Slots ---
    # Group by (season, week, team_number) to assign slots in order
    from collections import defaultdict
    slot_groups = defaultdict(list)
    for i, dr in enumerate(data_rows):
        key = (dr['season'], dr['week'], dr['team'])
        slot_groups[key].append(i)

    team_slots = []
    row_to_slot_id = {}
    for key, indices in slot_groups.items():
        season_num, week_num, team_num = key
        week_id = seen_weeks[(season_num, week_num)]
        for slot_pos, row_idx in enumerate(indices):
            dr = data_rows[row_idx]
            slot_id = str(uuid.uuid4())
            is_fill = not dr['present']
            player_id = players[dr['player']]['id'] if (not is_fill and dr['player'] in players) else None
            team_slots.append({
                'id': slot_id,
                'week_id': week_id,
                'player_id': player_id,
                'team_number': team_num,
                'slot': slot_pos,
                'is_fill': is_fill,
            })
            row_to_slot_id[row_idx] = slot_id

    print(f"Team slots: {len(team_slots)}")

    # --- Game Schedule ---
    game_schedule_set = set()
    game_schedule = []
    for dr in data_rows:
        week_id = seen_weeks[(dr['season'], dr['week'])]
        my_team = dr['team']

        if dr['game1_opp'] is not None:
            a, b = min(my_team, dr['game1_opp']), max(my_team, dr['game1_opp'])
            key = (week_id, 1, a, b)
            if key not in game_schedule_set:
                game_schedule_set.add(key)
                game_schedule.append({
                    'id': str(uuid.uuid4()),
                    'week_id': week_id,
                    'game_number': 1,
                    'team_a': a,
                    'team_b': b,
                })

        if dr['game2_opp'] is not None:
            a, b = min(my_team, dr['game2_opp']), max(my_team, dr['game2_opp'])
            key = (week_id, 2, a, b)
            if key not in game_schedule_set:
                game_schedule_set.add(key)
                game_schedule.append({
                    'id': str(uuid.uuid4()),
                    'week_id': week_id,
                    'game_number': 2,
                    'team_a': a,
                    'team_b': b,
                })

    print(f"Game schedule rows: {len(game_schedule)}")

    # --- Scores ---
    scores = []
    for i, dr in enumerate(data_rows):
        slot_id = row_to_slot_id[i]
        if dr['game1'] is not None:
            scores.append({
                'id': str(uuid.uuid4()),
                'team_slot_id': slot_id,
                'game_number': 1,
                'score': int(dr['game1']),
            })
        if dr['game2'] is not None:
            scores.append({
                'id': str(uuid.uuid4()),
                'team_slot_id': slot_id,
                'game_number': 2,
                'score': int(dr['game2']),
            })

    print(f"Scores: {len(scores)}")

    # --- Season Champions ---
    # Sheet 12, rows 2-4: CJ, Troy, Nick for season 1
    champ_rows = champions_rows[1:]  # skip header
    champion_names = []
    for row in champ_rows:
        name = row.get(0)
        if name and isinstance(name, str) and name.strip():
            champion_names.append(name.strip())

    print(f"Champions from sheet: {champion_names}")

    # Fallback to known values from ETL.md if sheet parsing fails
    if not champion_names:
        champion_names = ['CJ', 'Troy', 'Nick']

    season_champions = []
    for name in champion_names:
        if name in players:
            season_champions.append({
                'id': str(uuid.uuid4()),
                'season_id': 1,
                'player_id': players[name]['id'],
            })
        else:
            print(f"  WARNING: champion '{name}' not found in players")

    print(f"Season champions: {len(season_champions)}")

    # --- Write SQL ---
    lines = []

    lines.append('-- players')
    for p in players.values():
        lines.append(
            f"INSERT INTO players (id, name, phone, is_active) VALUES "
            f"({q(p['id'])}, {q(p['name'])}, {q(p['phone'])}, {q(p['is_active'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- seasons')
    for s in seasons.values():
        lines.append(
            f"INSERT INTO seasons (id, number, league_name, bowling_night, started_at, ended_at) VALUES "
            f"({q(s['id'])}, {q(s['number'])}, {q(s['league_name'])}, {q(s['bowling_night'])}, "
            f"{q(s['started_at'])}, {q(s['ended_at'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- weeks')
    for w in weeks:
        lines.append(
            f"INSERT INTO weeks (id, season_id, week_number, bowled_at, is_confirmed, is_archived) VALUES "
            f"({q(w['id'])}, {q(w['season_id'])}, {q(w['week_number'])}, {q(w['bowled_at'])}, "
            f"{q(w['is_confirmed'])}, {q(w['is_archived'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- team_slots')
    for ts in team_slots:
        lines.append(
            f"INSERT INTO team_slots (id, week_id, player_id, team_number, slot, is_fill) VALUES "
            f"({q(ts['id'])}, {q(ts['week_id'])}, {q(ts['player_id'])}, {q(ts['team_number'])}, "
            f"{q(ts['slot'])}, {q(ts['is_fill'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- game_schedule')
    for gs in game_schedule:
        lines.append(
            f"INSERT INTO game_schedule (id, week_id, game_number, team_a, team_b) VALUES "
            f"({q(gs['id'])}, {q(gs['week_id'])}, {q(gs['game_number'])}, {q(gs['team_a'])}, {q(gs['team_b'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- scores')
    for sc in scores:
        lines.append(
            f"INSERT INTO scores (id, team_slot_id, game_number, score) VALUES "
            f"({q(sc['id'])}, {q(sc['team_slot_id'])}, {q(sc['game_number'])}, {q(sc['score'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append('')
    lines.append('-- season_champions')
    for ch in season_champions:
        lines.append(
            f"INSERT INTO season_champions (id, season_id, player_id) VALUES "
            f"({q(ch['id'])}, {q(ch['season_id'])}, {q(ch['player_id'])}) "
            f"ON CONFLICT DO NOTHING;"
        )

    sql = '\n'.join(lines)
    with open(OUT, 'w') as f:
        f.write(sql)

    print(f"\nWrote {len(lines)} lines to {OUT}")
    print(f"Summary: {len(players)} players, {len(seasons)} seasons, {len(weeks)} weeks, "
          f"{len(team_slots)} team_slots, {len(game_schedule)} game_schedule, "
          f"{len(scores)} scores, {len(season_champions)} champions")


if __name__ == '__main__':
    main()
