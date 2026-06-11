# db.ts Query Objects

All database queries MUST be implemented in `db.ts`. Queries like `scores.listForStandings()` join the right tables in one round-trip. Avoid building ad-hoc joins from raw `supabase` client calls; add a new method to `db.ts` if needed.

### `boardPosts`
| Method | Description |
|---|---|
| `list()` | All posts with joined player name, newest first |
| `insert(data)` | Insert a new post |
| `remove(id)` | Delete a post by id |

### `games`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | Game rows for one week (filters via the team-a → `teams.week_id` embed) |
| `listForArchivedWeeks()` | All game rows for archived weeks (used by standings/chemistry/H2H/past-games) — includes `id`, `team_a_id`, `team_b_id`, and the week via embedded `teams(week_id)` |
| `insert(data)` | Insert one or many game rows |
| `remove(id)` | Delete by id |
| `removeByWeekAndGame(weekId, gameNumber)` | Delete a specific game (by game number) for a week — resolves the week's team ids, then deletes by `team_a_id` |

### `players`
| Method | Description |
|---|---|
| `list()` | All players, ordered by name |
| `listActive()` | Active players only |
| `getById(id)` | Single player by id |
| `getByName(name)` | Case-insensitive name match (single) |
| `getByUserId(userId)` | Single player (`id, name, role`) by auth `user_id` |
| `isRegistered(phone)` | RPC `is_registered_player` — whether a phone belongs to a registered player (login gate) |
| `insert(data)` | Add a player |
| `update(id, data)` | Update player fields (incl. `avatar_path`) |

### `avatars` (player profile pictures — private `avatars` storage bucket)
| Method | Description |
|---|---|
| `upload(path, body, contentType)` | Upsert a photo to the `avatars` bucket; `path` = `<playerId>.jpg`. **Admin-only** (storage RLS) |
| `remove(path)` | Delete a photo from the bucket. **Admin-only** |
| `signedUrls(paths, expiresIn?)` | Batch-create signed download URLs (default 1h) — bucket is private, so reads need signed URLs |

> **Profile pictures:** images live in a **private** `avatars` Storage bucket. Storage RLS: any **`authenticated`** user can read (via signed URLs); only **`admin`** can INSERT/UPDATE/DELETE (mirrors the `(auth.jwt()->'app_metadata'->>'role')='admin'` pattern). `players.avatar_path` holds the storage key (`NULL` = no photo → UI falls back to initials). Admins set/delete photos on behalf of players from the **Profile Pictures** screen — there is no self-service upload. Signed URLs are cached centrally in `useAvatarStore` and rendered via the `<PlayerAvatar>` component.

### `rsvp`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All RSVPs for a week with joined player name |
| `upsert(data)` | Insert or update on `player_id, week_id` conflict |
| `remove(id)` | Delete by id |
| `removeByWeek(weekId)` | Clear all RSVPs for a week |

### `scores`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | Scores for a live week (joins team_slots) |
| `listByWeekWithGames(weekId)` | Non-fill scores for a week with `games(game_number)` join (settlement now runs server-side in `settle_betting_for_week`) |
| `listBySeason(seasonId)` | Archived, non-fill scores for a season (for avg calc) |
| `listAllArchived()` | All archived non-fill scores |
| `listForStandings()` | Archived scores with full player/week/season join (standings, chemistry, past seasons) |
| `listForPlayerDetail()` | Archived scores with slot/week/season join (player detail screen) |
| `listForH2H()` | Archived scores with player/week/season join (head-to-head) |
| `listForLeagueRecords()` | Archived scores with player/week/season join (league records) |
| `listForPastGames()` | Archived scores with slot/team/week join — embeds `teams(team_number)` (past games screen) |
| `insert(data)` | Insert one or many scores |
| `upsert(data)` | Upsert on `team_slot_id, game_id` conflict |
| `update(id, data)` | Update a score by id |
| `removeBySlotIds(ids)` | Delete scores for a list of slot ids |
| `remove(teamSlotId, gameId)` | Delete a specific score |

### `seasonChampions`
| Method | Description |
|---|---|
| `list()` | All champions with joined player name and season |
| `listBySeason(seasonId)` | Champions for one season |
| `insert(data)` | Record a champion |
| `remove(id)` | Delete a champion record |

### `registrations`
| Method | Description |
|---|---|
| `list()` | All registrations with joined player `(id, name)` |
| `listBySeason(seasonId)` | Registrations for one season with joined player |
| `insert(data)` | Add a registration (sign a player up for a season) |
| `remove(seasonId, playerId)` | Delete a sign-up by `(season_id, player_id)` |

### `seasons`
| Method | Description |
|---|---|
| `list()` | All seasons, ordered by number |
| `getLatest()` | Highest-`number` season (single) — use **only** for computing the next season number, not "current" |
| `getCurrent()` | The current playing season: `is_active = true` AND `registration_open = false` (single). **Use this for "what season is it now"**, not `getLatest()` |
| `getLastEnded()` | Most recently ended season (`is_active = false`, `registration_open = false`, highest number) — used to look up champions when crediting the new-season champion bonus |
| `getById(id)` | Single season by id |
| `insert(data)` | Create a season |
| `update(id, data)` | Update season fields |
| `remove(id)` | Delete a season by id (admin; registrations cascade) |
| `settleLoansForClose(seasonId)` | RPC `settle_loans_for_season_close` — pay `min(balance, outstanding)` per active loan, mark loans `season_closed`. Called by `AdminEndSeasonModal` before marking the season inactive |

### `betMarkets` (canonical over/under markets — see [PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md))
| Method | Description |
|---|---|
| `listOpenOUByWeek(weekId)` | Open `over_under` markets for a week with subject name + `bet_selections(*)` (Place Bets) |
| `setOUStatusByWeekGame(weekId, gameNumber, status)` | Admin per-game open/close — flips all `over_under` markets for a week's game number to `'open'`/`'closed'` (only toggles rows currently in the opposite status) |
| `syncOUForWeek(weekId, extraGames?)` | RPC `sync_over_under_markets_for_week` — RSVP-driven create/refund of markets; `extraGames` adds schedule games (team-gen game 3) |
| `settle(marketId, resultValue)` | RPC `settle_market` (admin) — settle one market against the subject's actual score |
| `settleForWeek(weekId)` | RPC `settle_betting_for_week` (admin) — credit `score_credit` + settle all open markets on archive |

### `bets` (canonical stakes)
| Method | Description |
|---|---|
| `listByPlayer(playerId)` | A player's bets with `bet_legs → bet_selections → bet_markets`(+subject, +week) — newest first |
| `listByWeek(weekId)` | All bets with a leg on an `over_under` market in this week (Active Bets) |
| `listSettledBySeason(seasonId)` | All settled bets for a season with the full leg/selection/market(+week) graph (Settled Bets) |
| `place(selectionIds, stake)` | RPC `place_house_bet` — atomic, balance/anti-tank-checked; O/U passes one selection id |
| `cancel(betId)` | RPC `cancel_bet` (admin) — total undo: removes ledger pair(s) + bet, re-opens a settled market if it was the last bet |

### `customLines` (admin "Specials" — see [betting-line-board.md](betting-line-board.md))
Presentation templates bundling existing `bet_selections`; taking one places an ordinary bet via `bets.place`. All writes are direct table ops through admin RLS (no money moves).
| Method | Description |
|---|---|
| `listActive()` | Active lines, newest first (Place Bets board; week applicability filtered client-side in `usePinsinoData`) |
| `listAll()` | Every line incl. disabled (the admin Specials manager) |
| `create(data)` / `update(id, data)` / `remove(id)` | Direct CRUD; edits replace `legs` jsonb wholesale and never affect placed bets |

### `pinLedger`
| Method | Description |
|---|---|
| `listByPlayerSeason(playerId, seasonId)` | All ledger entries for a player in a season — newest first. `SUM(amount)` = balance. Embeds `weeks(week_number)` + the bet graph (`bets(*, players(name), <LEG_GRAPH>)`) off `bet_id` so a `bet_*` row can render full bet detail (see **Betting display components**) |
| `listHouseBySeason(seasonId)` | House-side rows for a season (`is_house = true`) — the betting counterparty + bonus funder. Same `weeks` + bet-graph embed as above. Drives PinsinoAccountingScreen (Activity) |
| `listBySeasonForLeaderboard(seasonId)` | Player entries (`is_house = false`) for a season with joined `players(name, is_active)` — for the pin-balance scoreboard |
| `insert(data)` | Insert one or many entries (champion bonus). Betting transfers are written by the RPCs, not here |

### `loanProducts`
| Method | Description |
|---|---|
| `list()` | All products ordered by `sort_order` |
| `listAvailable()` | Active products only (`is_active = true`); full availability (window, max_uses) re-checked server-side in `take_loan` |

### `loans`
| Method | Description |
|---|---|
| `listByPlayer(playerId)` | A player's loans with joined `loan_products(*)`, newest first |
| `listActiveBySeason(seasonId)` | Active loan ids + player ids for a season — leaderboard debt calculation |
| `listActiveDetailed(seasonId)` | Active loans with joined `players(name)` + `loan_products(display_name, borrow_amount)` — admin list |
| `take(productId)` | RPC `take_loan` — resolves identity from `auth.uid()`, checks availability + one-loan-at-a-time rule, creates the loan and double-entry pin pair |
| `repay(loanId, amount)` | RPC `repay_loan` — partial or full repayment; marks `paid_off` when outstanding reaches 0 |
| `cancel(loanId)` | RPC `cancel_loan` (admin) — destructive rollback: deletes all `pin_ledger` + `loan_ledger` rows and the loan itself |

### `loanLedger`
| Method | Description |
|---|---|
| `listByPlayerSeason(playerId, seasonId)` | Debt event history for a borrower in a season (payment history screen), newest first. Embeds `weeks(week_number)` |
| `listActiveBySeason(seasonId)` | All debt rows for active loans in a season — summed per player for the net-worth leaderboard |

### `teamSlots`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All slots for a week with joined player name + `teams(team_number, week_id)` (filters via `teams.week_id`) |
| `listByPlayer(playerId)` | All archived slots for a player with `team_id` and the week/season join embedded under `teams` |
| `insert(data)` | Insert one or many slots |
| `update(id, data)` | Update a slot |
| `remove(id)` | Delete a slot |

### `teams`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All team rows for a week, ordered by `team_number` |
| `insert(data)` | Insert one or many teams; chains `.select()` so callers get the new ids back |
| `removeByWeek(weekId)` | Delete all teams for a week — cascades to its slots, games, and scores |

### `weeks`
| Method | Description |
|---|---|
| `list()` | All weeks, ordered by week_number |
| `listBySeason(seasonId)` | Weeks for a season |
| `getCurrent()` | Most recent non-archived week (current/upcoming) |
| `getActive()` | Most recent non-archived, confirmed week (live-scoring) |
| `getById(id)` | Single week by id |
| `insert(data)` | Create a week |
| `update(id, data)` | Update week fields |
