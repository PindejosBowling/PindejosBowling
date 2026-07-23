import { supabase } from '../client'
import type { TablesInsert, TablesUpdate, Json } from '../database.types'

// ── Target betting model (markets → selections → bets → legs) ───────────────
// The canonical over/under model. A market is one player×game×week O/U; its two
// selections ('over'/'under') share a line. A bet is a stake with one bet_leg
// per selection (single leg for O/U). Player write paths (place/cancel) and all
// admin lifecycle steps go through SECURITY DEFINER RPCs; reads embed the whole
// market/selection/leg graph in one round-trip. Subject embeds disambiguate the
// two players FKs on bet_markets via the constraint name.
const MARKET_GRAPH =
  '*, subject:players!bet_markets_subject_player_id_fkey(name), bet_selections(*)'
// Leg → selection → market(+subject, +week) graph, embedded under a bet.
const LEG_GRAPH =
  'bet_legs(*, bet_selections(*, bet_markets(*, subject:players!bet_markets_subject_player_id_fkey(name), weeks(week_number, seasons(number)))))'

export const betMarkets = {
  // Open over_under markets for a week (Place Bets), with selections + subject.
  listOpenOUByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .eq('status', 'open')
      .order('game_number')
      .order('subject_player_id'),
  // Active (open + closed-for-betting) over_under markets for a week, with
  // selections + subject. Closed markets are games "in progress" — still shown on
  // Place Bets (disabled) but no longer bettable. Excludes settled/void.
  listActiveOUByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .in('status', ['open', 'closed'])
      .order('game_number')
      .order('subject_player_id'),
  // game_number + status for a week's O/U markets — used to derive which games are
  // "in progress" (closed for betting) without pulling the full market graph.
  listOUStatusByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select('game_number, status')
      .eq('week_id', weekId)
      .eq('market_type', 'over_under'),
  // Active (open + closed-for-betting) prop markets for a week — the LaneTalk
  // stat lines (strikes/spares per game, clean%/first-ball avg per night).
  // Night markets carry game_number null and group under WEEKLY on the board.
  listActivePropByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .in('status', ['open', 'closed'])
      .order('game_number', { nullsFirst: false })
      .order('subject_player_id'),
  // Active (open + closed-for-betting) combo markets for a week — player-composed
  // aggregate lines over an explicit member set (params.member_ids/member_names),
  // with no team/game anchor. The player-subject embed resolves null; the row
  // label comes from params.member_names.
  listActiveComboByWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .eq('week_id', weekId)
      .eq('market_type', 'combo')
      .in('status', ['open', 'closed'])
      .order('game_number', { nullsFirst: false })
      .order('title'),
  // Active (open + closed-for-betting) markets by id, with selections + subject —
  // any market_type. Used by the "Copy this bet" flow to re-resolve a bet's legs
  // against the CURRENT live markets/selections (odds/lines may have moved since
  // placement). Excludes settled/void, so a copied bet whose market has since
  // settled simply won't resolve.
  getByIds: (ids: string[]) =>
    supabase
      .from('bet_markets')
      .select(MARKET_GRAPH)
      .in('id', ids)
      .in('status', ['open', 'closed']),
  // Unsettled LaneTalk-clock markets across ALL weeks — the import screen groups
  // these by week to surface its "Confirm LaneTalk Data" button. These ride a
  // separate settlement clock from archive (data lands the next day). Covers
  // both player props (source=lanetalk) and lanetalk-clock team props — the
  // Confirm RPC settles both, so the badge must count both.
  listUnsettledLanetalkProps: () =>
    supabase
      .from('bet_markets')
      .select('id, week_id, game_number, subject_player_id, params, status, title')
      .or('and(market_type.eq.prop,params->>source.eq.lanetalk),and(market_type.eq.team_prop,params->>clock.eq.lanetalk),and(market_type.eq.combo,params->>clock.eq.lanetalk)')
      .in('status', ['open', 'closed']),
  // Week ids that have settled LaneTalk-clock markets — pairs with
  // listUnsettledLanetalkProps so the import screen can mark a week Confirmed
  // (settled, none pending) vs Unconfirmed (some pending) vs no badge (no props).
  listSettledLanetalkPropWeeks: () =>
    supabase
      .from('bet_markets')
      .select('week_id')
      .or('and(market_type.eq.prop,params->>source.eq.lanetalk),and(market_type.eq.team_prop,params->>clock.eq.lanetalk),and(market_type.eq.combo,params->>clock.eq.lanetalk)')
      .eq('status', 'settled'),
  // Start/reopen a game's betting: flip every O/U market for a week+game between
  // 'open' and 'closed' in one admin write. Closing blocks new bets (place_house_bet
  // rejects non-open selections) but leaves settlement intact (settle_betting_for_week
  // settles any market with status <> 'settled').
  // Night total-pins O/U markets (game_number null) ride game 1's toggle, like
  // the night stat props — once the night's bowling starts, night betting closes.
  setOUStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'over_under')
      .is('game_number', null)
      .eq('status', from)
  },
  // Same open/close toggle for a week+game's moneyline markets (run alongside the
  // O/U toggle when a game starts/reopens — both close so the board goes inert).
  setMoneylineStatusByWeekGame: (weekId: string, gameNumber: number, status: 'open' | 'closed') =>
    supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'moneyline')
      .eq('game_number', gameNumber)
      .eq('status', status === 'closed' ? 'open' : 'closed'),
  // Same open/close toggle for a week+game's stat-prop markets (run alongside the
  // O/U + moneyline toggles when a game starts/reopens). Night-scoped props
  // (game_number null) ride game 1's toggle — once the night's bowling starts,
  // night-stat betting closes too.
  setPropStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'prop')
      .is('game_number', null)
      .eq('status', from)
  },
  // Same open/close toggle for a week+game's team-prop markets (run alongside
  // the other toggles when a game starts/reopens). Night-scoped team props
  // (game_number null) ride game 1's toggle, like the night player props.
  setTeamPropStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'team_prop')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'team_prop')
      .is('game_number', null)
      .eq('status', from)
  },
  // Same open/close toggle for a week+game's combo markets (run alongside the
  // other toggles when a game starts/reopens). Night-scoped combos
  // (game_number null) ride game 1's toggle, like the night player props.
  setComboStatusByWeekGame: async (weekId: string, gameNumber: number, status: 'open' | 'closed') => {
    const from = status === 'closed' ? 'open' : 'closed'
    const res = await supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'combo')
      .eq('game_number', gameNumber)
      .eq('status', from)
    if (res.error || gameNumber !== 1) return res
    return supabase
      .from('bet_markets')
      .update({ status })
      .eq('week_id', weekId)
      .eq('market_type', 'combo')
      .is('game_number', null)
      .eq('status', from)
  },
  // Reopen every closed O/U line for a week. Clear Matchups returns the week to a
  // pre-game state, so Start Game's betting suspension must not survive the reset —
  // surviving lines (both players still RSVP'd in) would otherwise be stranded
  // unbettable with no games row left to expose the reopen toggle.
  // Covers stat props, team props and combos too — they suspend with the games,
  // so the reset must reopen them alongside the O/U lines.
  reopenOUForWeek: (weekId: string) =>
    supabase
      .from('bet_markets')
      .update({ status: 'open' })
      .eq('week_id', weekId)
      .in('market_type', ['over_under', 'prop', 'team_prop', 'combo'])
      .eq('status', 'closed'),
  // Create/refund of O/U markets (SECURITY DEFINER, server-side). Line ownership:
  // RSVP owns the lines until the week has teams; the roster (team_slots) owns
  // them after — ineligible subjects and game numbers outside the schedule are
  // pruned (bets refunded whole). DB triggers on rsvp/team_slots/games re-run
  // this sync after any mutation, so explicit calls here are belt-and-braces.
  // extraGames adds schedule game numbers not yet present (team-gen game 3).
  syncOUForWeek: (weekId: string, extraGames: number[] = []) =>
    supabase.rpc('sync_over_under_markets_for_week', { p_week_id: weekId, p_extra_games: extraGames }),
  // Server-side create/prune/reprice of LaneTalk stat-prop markets — same
  // coupling model as the O/U sync (run by the rsvp/team_slots/games/scores
  // resync triggers; explicit calls here are belt-and-braces). Lines are
  // seeded from each player's official imports; no imports → no lines.
  syncLanetalkPropsForWeek: (weekId: string) =>
    supabase.rpc('sync_lanetalk_prop_markets_for_week', { p_week_id: weekId }),
  // Schedule-driven create of even-money moneyline markets (one per games row),
  // SECURITY DEFINER. Run on team generation / when a game is added, not on RSVP.
  syncMoneylineForWeek: (weekId: string) =>
    supabase.rpc('sync_moneyline_markets_for_week', { p_week_id: weekId }),
  // Admin: refund every bet on a week+game's O/U markets and drop the markets —
  // the inverse of syncOUForWeek's create, used when a schedule game is removed.
  removeOUForGame: (weekId: string, gameNumber: number) =>
    supabase.rpc('remove_over_under_markets_for_game', { p_week_id: weekId, p_game_number: gameNumber }),
  // Admin: settle one market against the subject's actual score.
  settle: (marketId: string, resultValue: number) =>
    supabase.rpc('settle_market', { p_market_id: marketId, p_result_value: resultValue }),
  // Admin: settle one moneyline market from its game's scores (winner = higher
  // combined team total; tie → push). No score input — derived server-side.
  settleMoneyline: (marketId: string) =>
    supabase.rpc('settle_moneyline_market', { p_market_id: marketId }),
  // Admin: credit scores + settle all open markets for an archived week.
  settleForWeek: (weekId: string) =>
    supabase.rpc('settle_betting_for_week', { p_week_id: weekId }),
  // Admin: settle the week's LaneTalk stat props from imported official games —
  // the "Confirm LaneTalk Data" clock, separate from archive. Actuals are
  // derived server-side from lanetalk_game_imports.payload (the client never
  // supplies a result value). voidMissing deletes markets with no data (the
  // delete-refund rail); otherwise they stay pending for a later re-run.
  // Returns one summary row { settled, voided, left_pending } for the toast.
  settleLanetalkProps: (weekId: string, voidMissing = false) =>
    supabase.rpc('settle_lanetalk_props_for_week', { p_week_id: weekId, p_void_missing: voidMissing }),
  // Per-player per-game averages for a stat (STABLE, read-only) — the
  // combine-mode member list shows these so a bettor can see where the combo
  // line sits relative to the group's actual production. Season-scoped with
  // an explicit fallback chain reported in `source`: 'season' → 'lifetime'
  // (→ 'league' for total_pins only). `games` = the counted-game denominator
  // of the rung that answered (0 for the league fallback). Display-only;
  // the seed/pricing math reads its own windows.
  comboMemberAverages: (playerIds: string[], stat: string, seasonId: string) =>
    supabase.rpc('combo_member_averages', {
      p_player_ids: playerIds, p_stat: stat, p_season_id: seasonId,
    }),
  // The book's per-stat projection for one player next to their current-season
  // average (STABLE, read-only) — one row per stat ('score' / 'clean_frames' /
  // 'strikes' / 'spares'), all values PER GAME (the client scales night scope
  // × games). `projected` is the engine's rounded mean — NULL when the engine
  // is disabled; `season_avg` resolves through combo_member_averages' fallback
  // chain with `avg_source` ('season'/'lifetime'/'league') + `avg_games` so
  // the display can label honestly. Display-only; no pricing path reads it.
  playerProjection: (playerId: string, seasonId: string) =>
    supabase.rpc('odds_engine_player_projection', {
      p_player_id: playerId, p_season_id: seasonId,
    }),
  // Batched book projections for one COMBO stat ('total_pins' maps to the
  // engine's 'score') — the combine-mode member list shows these beside the
  // averages so a bettor can pick members the book rates above/below their
  // average. PER-GAME values, `projected` NULL when the engine is disabled.
  // Display-only; the compose/pricing path reads its own model.
  memberProjections: (playerIds: string[], stat: string, seasonId: string) =>
    supabase.rpc('odds_engine_member_projections', {
      p_player_ids: playerIds, p_stat: stat, p_season_id: seasonId,
    }),
  // Value-first pricing: quote ANY half-point line on one market (STABLE,
  // read-only). NULL line → the seed rung (the pill's anchor). Posted rungs
  // echo their posted odds verbatim; unposted lines price fresh inside the
  // custom band. Returns { line, odds, posted, seed_line, seed_odds,
  // min_line, max_line } — odds null = "line unavailable". The distribution
  // itself never leaves the server.
  priceMarketLine: (marketId: string, line?: number | null) =>
    supabase.rpc('market_price_line', {
      p_market_id: marketId,
      ...(line != null ? { p_line: line } : {}),
    }),
  // The same quote for a combo member set (the combo stat pills' editor). An
  // existing open market's posted rungs echo verbatim and its seed anchors
  // the editor; unposted lines price fresh (the rung mints at compose time).
  priceComboLine: (
    memberIds: string[], stat: string, seasonId: string, nGames = 1,
    weekId?: string | null, gameNumber?: number | null, line?: number | null,
  ) =>
    supabase.rpc('combo_price_line', {
      p_member_ids: memberIds, p_stat: stat, p_season_id: seasonId, p_n_games: nGames,
      p_week_id: weekId ?? undefined, p_game_number: gameNumber ?? undefined,
      ...(line != null ? { p_line: line } : {}),
    }),
}

export const bets = {
  // A player's bets with leg → selection → market(+subject), newest first.
  listByPlayer: (playerId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('player_id', playerId)
      .order('placed_at', { ascending: false }),
  // All bets with a leg on one of this week's markets (Active Bets).
  // Deliberately market-type-agnostic — the week_id filter on the joined
  // market is the whole scope, so new market types flow through with no edit
  // here (a now-removed type enumeration once made prop-only bets vanish and
  // truncated mixed parlays' embeds: inner-join filters gate the bet AND
  // prune its embedded legs).
  listByWeek: (weekId: string) =>
    supabase
      .from('bets')
      .select(
        '*, players(name), bet_legs!inner(*, bet_selections!inner(*, ' +
        'bet_markets!inner(*, subject:players!bet_markets_subject_player_id_fkey(name))))'
      )
      .eq('bet_legs.bet_selections.bet_markets.week_id', weekId)
      .order('placed_at', { ascending: false }),
  // All settled bets for a season (Settled Bets), with leg → selection → market(+week).
  listSettledBySeason: (seasonId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('season_id', seasonId)
      .not('settled_at', 'is', null)
      .order('settled_at', { ascending: false }),
  // One bet with its full leg → selection → market graph (Bet Details overlay,
  // e.g. opened from a Market Moves placement card).
  getById: (betId: string) =>
    supabase
      .from('bets')
      .select('*, players(name), ' + LEG_GRAPH)
      .eq('id', betId)
      .single(),
  // Place a house bet atomically (SECURITY DEFINER); O/U passes one selection id.
  // customLineId tags the bet with a special's identity (title/description/
  // category snapshotted server-side, so branding survives line edits/deletion).
  // insuranceItemId attaches a Golden Ticket (consumed at placement, win or
  // lose; if the bet loses the stake refunds at settlement). crutchItemId
  // attaches a Winner's Crutch (parlays only; cancels the lone losing leg and
  // pays the survivors at reduced odds). boostItemId attaches an Energy Drink
  // (any bet; on a win the House pays a bonus = payout × boost_pct, doubling the
  // total payout). All three are spent at placement and stack.
  place: (selectionIds: string[], stake: number, customLineId?: string, insuranceItemId?: string, crutchItemId?: string, boostItemId?: string) =>
    // undefined is dropped from the RPC payload → the param's NULL default applies.
    supabase.rpc('place_house_bet', { p_selection_ids: selectionIds, p_stake: stake, p_custom_line_id: customLineId, p_insurance_item_id: insuranceItemId, p_crutch_item_id: crutchItemId, p_boost_item_id: boostItemId }),
  // Value-first placement (SECURITY DEFINER): picks are line-shaped —
  // { marketId, line, quotedOdds } — the server prices each line
  // authoritatively, mints the over/under rung pair if absent, and routes
  // into place_house_bet. A quote drifted beyond quote_tolerance rejects
  // with 'ODDS_MOVED|<market_id>|<quoted>|<fresh>' (parse for the confirm
  // sheet); items pass through exactly like bets.place.
  placeAtLines: (
    picks: { marketId: string; line: number; quotedOdds: number }[],
    stake: number,
    insuranceItemId?: string, crutchItemId?: string, boostItemId?: string,
  ) =>
    supabase.rpc('place_bet_at_lines', {
      p_picks: picks.map(p => ({
        market_id: p.marketId, line: p.line, quoted_odds: p.quotedOdds,
      })) as unknown as Json,
      p_stake: stake,
      p_insurance_item_id: insuranceItemId,
      p_crutch_item_id: crutchItemId,
      p_boost_item_id: boostItemId,
    }),
  // Parlay preview: the joint (correlation-repriced) price for a prospective
  // ticket — picks {marketId, line, quotedOdds} + marketless combo specs.
  // Returns {odds, correlated, factors} or {blocked_player_id} when a 3+ leg
  // correlated cluster would be rejected at placement. Display only —
  // place_house_bet reprices authoritatively.
  parlayPrice: (
    weekId: string | null,
    picks: { marketId: string; line: number; quotedOdds: number }[],
    combos: { memberIds: string[]; stat: string; scope: 'game' | 'night'; gameNumber: number | null; line: number; quotedOdds: number }[],
  ) =>
    supabase.rpc('parlay_price', {
      p_week_id: weekId ?? undefined,
      p_picks: picks.map(p => ({
        market_id: p.marketId, line: p.line, quoted_odds: p.quotedOdds,
      })) as unknown as Json,
      p_combos: combos.map(c => ({
        member_ids: c.memberIds, stat: c.stat, scope: c.scope,
        game_number: c.gameNumber, line: c.line, quoted_odds: c.quotedOdds,
      })) as unknown as Json,
    }),
  // Admin: total undo of a placed bet (removes ledger rows + bet, re-opens market).
  cancel: (betId: string) =>
    supabase.rpc('cancel_bet', { p_bet_id: betId }),
  // Place a slip bet containing ≥1 combo specs in ONE transaction (SECURITY
  // DEFINER): each spec creates (or dedups into) its member-set market +
  // over/under selections, then ONE bet is placed across every combo's over
  // plus any extra staged selection ids — so a ticket can parlay a combo with
  // single lines AND with other combos. A combo market can never exist without
  // a bet riding it (a failed placement rolls the new markets back). Item ids
  // pass through to place_house_bet (single-bet slips only, per BetSlip's
  // gating). Returns { bet_id, combos: [{market_id, line, deduped}] }.
  composeCombo: (
    weekId: string,
    combos: { memberIds: string[]; stat: string; scope: 'game' | 'night'; gameNumber: number | null; line?: number | null; quotedOdds?: number | null }[],
    stake: number,
    extraSelectionIds?: string[],
    insuranceItemId?: string,
    crutchItemId?: string,
    boostItemId?: string,
    extraPicks?: { marketId: string; line: number; quotedOdds: number }[],
  ) =>
    supabase.rpc('compose_combo_bet', {
      p_week_id: weekId,
      p_combos: combos.map(c => ({
        member_ids: c.memberIds, stat: c.stat, scope: c.scope,
        ...(c.gameNumber != null ? { game_number: c.gameNumber } : {}),
        // Chosen value (the combo pill/sheet editor); omitted = the seed rung.
        // With quoted_odds attached, an unposted line MINTS on demand
        // (tolerance-checked); without it, posted rungs only.
        ...(c.line != null ? { line: c.line } : {}),
        ...(c.line != null && c.quotedOdds != null ? { quoted_odds: c.quotedOdds } : {}),
      })) as unknown as Json,
      p_stake: stake,
      p_extra_selection_ids: extraSelectionIds,
      p_insurance_item_id: insuranceItemId,
      p_crutch_item_id: crutchItemId,
      p_boost_item_id: boostItemId,
      // Line-shaped regular legs riding the same ticket (minted via the same
      // helper) — a combo + custom-line single stays ONE bet.
      ...(extraPicks && extraPicks.length
        ? { p_extra_picks: extraPicks.map(p => ({
              market_id: p.marketId, line: p.line, quoted_odds: p.quotedOdds,
            })) as unknown as Json }
        : {}),
    }),
}

// ── Ghost in the Slip (bet_haunts) ──────────────────────────────────────────
// The adversarial item: a player secretly attaches a Ghost to ANOTHER player's
// pending bet. If it wins, the ghosts split the profit and the bettor keeps only
// their stake (settled in finalize_bets_for_market). RLS keeps a pending haunt
// visible only to its haunter; it goes public once the target bet has WON.
export const haunts = {
  // The viewer's own haunts (RLS returns only the caller's rows) — used to mark
  // bets they've already haunted so the CTA disables. Returns bet_ids.
  listMine: (playerId: string) =>
    supabase.from('bet_haunts').select('bet_id').eq('haunter_player_id', playerId),
  // Haunters on one bet, oldest first. RLS reveals foreign rows ONLY once the bet
  // has won (or to the haunter themselves) — drives the Bet Details reveal.
  listForBet: (betId: string) =>
    supabase.from('bet_haunts')
      .select('payout_amount, attached_at, players(name)')
      .eq('bet_id', betId)
      .order('attached_at', { ascending: true }),
  // Secretly haunt a foreign pending bet (SECURITY DEFINER; consumes the item).
  create: (targetBetId: string, itemId: string) =>
    supabase.rpc('haunt_bet', { p_target_bet_id: targetBetId, p_item_id: itemId }),
}

// ── Custom lines ("Specials") ────────────────────────────────────────────────
// Admin-authored templates bundling existing bet_selections under a custom
// title. Legs are abstract specs ({kind, player_id, game_number, pick}) resolved
// client-side against the week's markets in usePinsinoData; taking one places an
// ordinary single/parlay via bets.place — no bespoke settlement path. week_ids
// null = permanent (offered every week while is_active). Admin writes are direct
// table ops through RLS (no money moves at create/edit time).
export const customLines = {
  // Place Bets board: active lines only; week applicability (week_ids null or
  // containing the current week) is filtered client-side in usePinsinoData.
  listActive: () =>
    supabase.from('custom_lines').select('*').eq('is_active', true).order('created_at', { ascending: false }),
  // Admin Specials view: everything, including disabled lines.
  listAll: () =>
    supabase.from('custom_lines').select('*').order('created_at', { ascending: false }),
  create: (data: TablesInsert<'custom_lines'>) =>
    supabase.from('custom_lines').insert(data),
  // Edits replace legs jsonb wholesale; bets already placed are unaffected —
  // they hold concrete selection ids snapshotted at placement.
  update: (id: string, data: TablesUpdate<'custom_lines'>) =>
    supabase.from('custom_lines').update(data).eq('id', id),
  remove: (id: string) =>
    supabase.from('custom_lines').delete().eq('id', id),
}

// ── Loan Shark (loan_products → loans → loan_ledger) ────────────────────────
// Immutable historical loan offers; a loan is lifecycle-only (balance derived
// from loan_ledger SUM(amount)). All player write paths (take/repay) and admin
// cancel go through SECURITY DEFINER RPCs; reads embed the product graph.
export const loanProducts = {
  list: () =>
    supabase.from('loan_products').select('*').order('sort_order'),
  // is_active filter only; full availability (window, max_uses, season) is
  // re-checked server-side in take_loan.
  listAvailable: () =>
    supabase.from('loan_products').select('*').eq('is_active', true).order('sort_order'),
}

export const loans = {
  // A player's loans (any status) with their product, newest first.
  listByPlayer: (playerId: string) =>
    supabase
      .from('loans')
      .select('*, loan_products(*)')
      .eq('player_id', playerId)
      .order('issued_at', { ascending: false }),
  // Active loans in a season (id + player) — feeds the net-worth leaderboard.
  listActiveBySeason: (seasonId: string) =>
    supabase
      .from('loans')
      .select('id, player_id')
      .eq('season_id', seasonId)
      .eq('status', 'active'),
  // Active loans in a season with player + product (admin list).
  listActiveDetailed: (seasonId: string) =>
    supabase
      .from('loans')
      .select('*, players(name), loan_products(display_name, borrow_amount)')
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .order('issued_at', { ascending: false }),
  // Active + paid-off loans in a season with player + product — the admin
  // cancel list, which can roll back loans that have already been repaid.
  listCancelableDetailed: (seasonId: string) =>
    supabase
      .from('loans')
      .select('*, players(name), loan_products(display_name, borrow_amount)')
      .eq('season_id', seasonId)
      .in('status', ['active', 'paid_off'])
      .order('issued_at', { ascending: false }),
  take: (productId: string) =>
    supabase.rpc('take_loan', { p_loan_product_id: productId }),
  repay: (loanId: string, amount: number) =>
    supabase.rpc('repay_loan', { p_loan_id: loanId, p_amount: amount }),
  // Admin: destructive rollback — removes the loan's pin + debt rows and the loan.
  cancel: (loanId: string) =>
    supabase.rpc('cancel_loan', { p_loan_id: loanId }),
}

export const loanLedger = {
  // A player's debt event history for a season (newest first) — the borrower's
  // payment history. SUM(amount) over a loan's rows = outstanding debt.
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('*, weeks(week_number)')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
  // All debt rows for active loans in a season — summed per player for the
  // net-worth leaderboard's Debt column.
  listActiveBySeason: (seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('player_id, amount, loan_id, loans!inner(status)')
      .eq('season_id', seasonId)
      .eq('loans.status', 'active'),
  // Debt rows for active + paid-off loans in a season — summed per loan for the
  // admin cancel list (paid-off loans net to 0).
  listCancelableBySeason: (seasonId: string) =>
    supabase
      .from('loan_ledger')
      .select('player_id, amount, loan_id, loans!inner(status)')
      .eq('season_id', seasonId)
      .in('loans.status', ['active', 'paid_off']),
}

export const pinLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('*, weeks(week_number), bets(*, players(name), ' + LEG_GRAPH + ')')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
  // House-side rows for a season (the betting counterparty + bonus funder).
  // Admin-only screen; RLS already permits authenticated SELECT on all rows.
  listHouseBySeason: (seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('*, weeks(week_number), bets(*, players(name), ' + LEG_GRAPH + ')')
      .eq('season_id', seasonId)
      .eq('is_house', true)
      .order('created_at', { ascending: false }),
  // Leaderboard is player balances only — exclude house rows (player_id IS NULL).
  listBySeasonForLeaderboard: (seasonId: string) =>
    supabase
      .from('pin_ledger')
      .select('player_id, amount, type, created_at, players(name, is_active)')
      .eq('season_id', seasonId)
      .eq('is_house', false),
  insert: (data: TablesInsert<'pin_ledger'> | TablesInsert<'pin_ledger'>[]) =>
    supabase.from('pin_ledger').insert(data),
  // Whether a player has already earned the RSVP self-submit bonus for a week —
  // backs the deadline banner's hide-once-claimed. Reads are RLS-open.
  rsvpBonusForWeek: (weekId: string, playerId: string) =>
    supabase
      .from('pin_ledger')
      .select('id')
      .eq('week_id', weekId)
      .eq('player_id', playerId)
      .eq('type', 'rsvp_bonus')
      .limit(1)
      .maybeSingle(),
  // All players paid the RSVP bonus for a week (player + sides only) — backs
  // the admin Missed Bonuses list, diffed against the week's rsvp rows.
  rsvpBonusesForWeek: (weekId: string) =>
    supabase
      .from('pin_ledger')
      .select('player_id')
      .eq('week_id', weekId)
      .eq('type', 'rsvp_bonus')
      .gt('amount', 0),
}

// Admin-issued, house-funded `bonus` pins (e.g. a "Reigning Champion" bonus).
// The RPC is admin-only, resolves the current season server-side, writes the
// double-entry pair per recipient, and publishes a Market Moves event each.
export const bonuses = {
  issue: (playerIds: string[], amount: number, label: string) =>
    supabase.rpc('issue_pin_bonus', {
      p_player_ids: playerIds,
      p_amount: amount,
      p_label: label,
    }),
}

// ── PvP Challenge Contracts (pvp_challenges → pvp_challenge_offers / pvp_ledger) ─
// Player-vs-player duels escrowed at acceptance; winner takes the whole pot (no
// rake). Lifecycle-only contract rows (escrow derived from pvp_ledger); all player
// write paths (create/counter/accept/decline) and admin tools (cancel/void/settle)
// go through SECURITY DEFINER RPCs. Reads embed the creator/counterparty names —
// the two FKs to players are disambiguated via their constraint names.
export interface CreatePvpArgs {
  contractType: string                 // 'line_duel' | 'prop_duel' | 'head_to_head' | 'custom'
  counterpartyId: string | null        // null = open board
  weekId: string
  gameNumber: number | null            // required for line/head_to_head; null for prop/custom
  creatorStake: number                 // the creator's own stake
  counterpartyStake: number            // the opponent's stake (equal to creator's unless custom)
  propMarketId: string | null          // prop_duel only
  creatorSelection: string | null      // prop_duel only ('over' | 'under')
  message: string | null
  customTitle: string | null           // custom only
  customDescription: string | null     // custom only — the admin-judged win condition
  creatorHandicap: number              // head_to_head only (signed pins; 0 = none)
  counterpartyHandicap: number         // head_to_head only (signed pins; 0 = none)
}

export interface CounterPvpArgs {
  challengeId: string
  creatorStake: number                 // role-fixed (creator side), not viewer-relative
  counterpartyStake: number            // role-fixed (counterparty side)
  contractType: string
  gameNumber: number | null
  propMarketId: string | null
  selection: string | null
  message: string | null
  creatorHandicap: number              // role-fixed; head_to_head only (signed pins)
  counterpartyHandicap: number         // role-fixed; head_to_head only (signed pins)
}

const CHALLENGE_PARTIES =
  '*, creator:players!pvp_challenges_creator_player_id_fkey(name), ' +
  'counterparty:players!pvp_challenges_counterparty_player_id_fkey(name)'

export const pvpChallenges = {
  // Inbox: everything involving this player for the current season, with a light
  // offer embed so the hook can tell whose turn it is (latest live offer's offerer).
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES +
        ', pvp_challenge_offers(offered_by_player_id, offer_no, superseded_at, accepted_at, declined_at)')
      .eq('season_id', seasonId)
      .or(`creator_player_id.eq.${playerId},counterparty_player_id.eq.${playerId}`)
      .order('created_at', { ascending: false }),

  // Open Challenge Board: open contracts awaiting any taker.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name)')
      .eq('season_id', seasonId)
      .is('counterparty_player_id', null)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

  // Challenges Won board: every settled contract leaguewide for the season,
  // newest result first. `status='settled'` implies a winner (pushed/voided
  // carry a null winner_player_id), so these are wins by definition. Both party
  // names are embedded so the public board can name winner and loser.
  listWonBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES)
      .eq('season_id', seasonId)
      .eq('status', 'settled')
      .order('settled_at', { ascending: false }),

  // Admin: active/locked + still-negotiating + settled contracts for the season.
  // Settled contracts are included so an admin can review and cancel them.
  listLockedBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES)
      .eq('season_id', seasonId)
      .in('status', ['pending', 'countered', 'locked', 'settled'])
      .order('created_at', { ascending: false }),

  // Detail page: one contract with its full negotiation trail + ledger.
  getById: (challengeId: string) =>
    supabase.from('pvp_challenges')
      .select(CHALLENGE_PARTIES +
        ', pvp_challenge_offers(*, offerer:players!pvp_challenge_offers_offered_by_player_id_fkey(name)), ' +
        'pvp_ledger(*, weeks(week_number))')
      .eq('id', challengeId).single(),

  create: (a: CreatePvpArgs) =>
    supabase.rpc('create_pvp_challenge', {
      p_contract_type: a.contractType,
      p_counterparty_player_id: a.counterpartyId as string,
      p_week_id: a.weekId,
      p_game_number: a.gameNumber as number,
      p_creator_stake: a.creatorStake,
      p_counterparty_stake: a.counterpartyStake,
      p_prop_market_id: a.propMarketId as string,
      p_creator_selection: a.creatorSelection as string,
      p_message: a.message as string,
      p_custom_title: a.customTitle as string,
      p_custom_description: a.customDescription as string,
      p_creator_handicap: a.creatorHandicap,
      p_counterparty_handicap: a.counterpartyHandicap,
    }),
  counter: (a: CounterPvpArgs) =>
    supabase.rpc('counter_pvp_challenge', {
      p_challenge_id: a.challengeId,
      p_creator_stake: a.creatorStake,
      p_counterparty_stake: a.counterpartyStake,
      p_contract_type: a.contractType,
      p_game_number: a.gameNumber as number,
      p_prop_market_id: a.propMarketId as string,
      p_selection: a.selection as string,
      p_message: a.message as string,
      p_creator_handicap: a.creatorHandicap,
      p_counterparty_handicap: a.counterpartyHandicap,
    }),
  // The Line Duel snapshot value for a player (floor(season avg)+0.5; league-avg
  // fallback). Used to preview each side's line-to-beat during create/counter
  // before it's frozen onto the contract.
  projectedLine: (playerId: string, seasonId: string) =>
    supabase.rpc('pvp_player_line', { p_player_id: playerId, p_season_id: seasonId }),
  accept: (challengeId: string) =>
    supabase.rpc('accept_pvp_challenge', { p_challenge_id: challengeId }),
  decline: (challengeId: string) =>
    supabase.rpc('decline_pvp_challenge', { p_challenge_id: challengeId }),
  // Admin: close every still-open challenge for a week (optionally one game).
  // Used by "Start Game" (game-scoped) and week settlement (gameNumber = null).
  closeOpenForGame: (weekId: string, gameNumber: number | null) =>
    supabase.rpc('close_open_pvp_challenges', { p_week_id: weekId, p_game_number: gameNumber as number }),
  cancel: (challengeId: string) =>
    supabase.rpc('cancel_pvp_challenge', { p_challenge_id: challengeId }),
  void: (challengeId: string, note: string) =>
    supabase.rpc('void_pvp_challenge', { p_challenge_id: challengeId, p_admin_note: note }),
  settle: (challengeId: string, winnerId: string | null, note: string) =>
    supabase.rpc('settle_pvp_challenge', {
      p_challenge_id: challengeId,
      p_source: 'admin',
      p_winner_player_id: winnerId as string,
      p_admin_note: note,
    }),
}

export const pvpLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_ledger').select('*, weeks(week_number)')
      .eq('player_id', playerId).eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
}

// ── Bounty Board (bounty_post → bounty_hunter_stakes / bounty_settlements / ──────
//    bounty_payouts) ────────────────────────────────────────────────────────────
// Public, pooled, manually-settled sponsor/house bounties with early-hunter
// anti-dilution + a House seed. Lifecycle-only rows; escrow lives directly on
// pin_ledger tagged with bounty_post_id. All player write paths (create-sponsor /
// enter) and admin tools (create-house / close / settle / cancel) go through
// SECURITY DEFINER RPCs. The single players FK on bounty_post is disambiguated by
// its constraint name; bounty_hunter_stakes / bounty_payouts use the implicit embed.
const BOUNTY_SPONSOR = 'sponsor:players!bounty_post_sponsor_player_id_fkey(name)'

export interface CreateBountyArgs {
  weekId: string
  title: string
  description: string
  rewardPerHunter: number              // R — what each hunter wins
  hunterStakeAmount: number            // H — what each hunter risks
  maxHunters: number                   // m — caps the sponsor's escrow at R*m
  closesAt: string                     // ISO timestamp (computed app-side, design §11)
}

export const bountyPosts = {
  // Public board: open bounties accepting hunters, current season.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', ' +
              'bounty_hunter_stakes(id, player_id, entry_number, protected_hunter_profit, stake_amount, status)')
      .eq('season_id', seasonId)
      .eq('status', 'open')
      .order('created_at', { ascending: false }),

  // Everything involving this player (sponsored or hunted) for the season.
  // The .or() across the embedded relation filters the embed, not the parent, so
  // it's bucketed client-side; the broad season fetch keeps it to one round trip.
  listByPlayerSeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),

  // Admin: bounties to manage for the season (filter client-side by status/type/week).
  listBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),

  // Detail: one bounty with hunters, settlement, and payouts.
  getById: (bountyId: string) =>
    supabase.from('bounty_post')
      .select('*, ' + BOUNTY_SPONSOR + ', ' +
              'bounty_hunter_stakes(*, players(name)), ' +
              'bounty_settlements(*), bounty_payouts(*, players(name))')
      .eq('id', bountyId).single(),

  createSponsor: (a: CreateBountyArgs) =>
    supabase.rpc('create_sponsor_bounty', {
      p_week_id: a.weekId,
      p_title: a.title,
      p_description: a.description,
      p_reward_per_hunter: a.rewardPerHunter,
      p_hunter_stake_amount: a.hunterStakeAmount,
      p_max_hunters: a.maxHunters,
      p_closes_at: a.closesAt,
    }),
  createHouse: (a: CreateBountyArgs) =>
    supabase.rpc('create_house_bounty', {
      p_week_id: a.weekId,
      p_title: a.title,
      p_description: a.description,
      p_reward_per_hunter: a.rewardPerHunter,
      p_hunter_stake_amount: a.hunterStakeAmount,
      p_max_hunters: a.maxHunters,
      p_closes_at: a.closesAt,
    }),
  enter: (bountyId: string) => supabase.rpc('enter_bounty_as_hunter', { p_bounty_post_id: bountyId }),
  close: (bountyId: string) => supabase.rpc('close_bounty', { p_bounty_post_id: bountyId }),
  settle: (bountyId: string, outcome: 'sponsor_win' | 'hunter_win', reasoning: string) =>
    supabase.rpc('settle_bounty', {
      p_bounty_post_id: bountyId,
      p_outcome: outcome,
      p_admin_settlement_reasoning: reasoning,
    }),
  cancel: (bountyId: string) => supabase.rpc('cancel_bounty', { p_bounty_post_id: bountyId }),
}

// Bounty-related ledger rows are plain pin_ledger rows tagged with bounty_post_id.
export const bountyLedger = {
  listByPost: (bountyId: string) =>
    supabase.from('pin_ledger').select('*, players(name)')
      .eq('bounty_post_id', bountyId)
      .order('created_at', { ascending: false }),
}

// ── Auction House (auctions / auction_bids) + item framework ─────────────────
// Sealed-bid pledge auctions (context/economy/AUCTION_FINDINGS.md). All writes
// go through SECURITY DEFINER RPCs — the tables carry NO write policies.
// auction_bids rows are owner-only with the amount encrypted at rest, so the
// existence of YOUR bid comes from a plain select (RLS filters to yours) but
// the amount is readable only via the my_bid_amount RPC.
const AUCTION_GRAPH =
  '*, item_catalog(key, name, description, icon, effect_type, activation_mode), ' +
  'winner:players!auctions_winner_player_id_fkey(name)'

export interface AuctionRpcInput {
  catalogKey: string
  description: string
  minimumBid: number
  opensAt: string
  closesAt: string
  // Units on the block (1–50): the top N sealed bidders each win one,
  // pay-as-bid.
  quantity: number
}

export const auctions = {
  // Auction House list: every auction of the season (open/scheduled/settled
  // sectioning is pure compute in utils/auction.ts).
  listBySeason: (seasonId: string) =>
    supabase.from('auctions').select(AUCTION_GRAPH)
      .eq('season_id', seasonId)
      .order('closes_at', { ascending: false }),
  getById: (auctionId: string) =>
    supabase.from('auctions').select(AUCTION_GRAPH).eq('id', auctionId).single(),
  // The viewer's own active bid rows (RLS: owner-only — other players' bids
  // never arrive). Amounts are ciphertext; use myBidAmount for the number.
  listMyBids: () =>
    supabase.from('auction_bids').select('id, auction_id, status').eq('status', 'active'),
  myBidAmount: (auctionId: string) =>
    supabase.rpc('my_bid_amount', { p_auction_id: auctionId }),
  // Public roster of active bidders (identity only, alphabetical) — live
  // auctions only; amounts stay sealed behind my_bid_amount.
  listBidders: (auctionId: string) =>
    supabase.rpc('auction_bidders', { p_auction_id: auctionId }),
  // Bids are commitments: placeBid also edits (>= minimum_bid). There is no
  // cancel — the RPC was dropped (no-cancel decision, AUCTION_FINDINGS).
  placeBid: (auctionId: string, amount: number) =>
    supabase.rpc('place_auction_bid', { p_auction_id: auctionId, p_amount: amount }),
  create: (a: AuctionRpcInput) =>
    supabase.rpc('create_auction', {
      p_catalog_key: a.catalogKey,
      p_description: a.description,
      p_minimum_bid: a.minimumBid,
      p_opens_at: a.opensAt,
      p_closes_at: a.closesAt,
      p_quantity: a.quantity,
    }),
  update: (auctionId: string, a: AuctionRpcInput) =>
    supabase.rpc('update_auction', {
      p_auction_id: auctionId,
      p_catalog_key: a.catalogKey,
      p_description: a.description,
      p_minimum_bid: a.minimumBid,
      p_opens_at: a.opensAt,
      p_closes_at: a.closesAt,
      p_quantity: a.quantity,
    }),
  openNow: (auctionId: string) =>
    supabase.rpc('open_auction_now', { p_auction_id: auctionId }),
  // Admin "Settle Now" = closing the auction: stamps closes_at and runs the
  // one settlement path (the same one the cron sweep calls).
  settle: (auctionId: string) =>
    supabase.rpc('settle_auction', { p_auction_id: auctionId }),
  cancel: (auctionId: string) =>
    supabase.rpc('cancel_auction', { p_auction_id: auctionId }),
  reverse: (auctionId: string) =>
    supabase.rpc('reverse_settled_auction', { p_auction_id: auctionId }),
}

// Auction House open/closed kill-switch (auction_house_state, one row per
// season). Read by everyone (drives the Pinsino tile overlay + entry gate);
// only admins can flip it, through the guarded RPC. Absent row = open.
export const auctionHouseState = {
  getBySeason: (seasonId: string) =>
    supabase.from('auction_house_state')
      .select('is_closed, closed_message')
      .eq('season_id', seasonId)
      .maybeSingle(),
  setClosed: (isClosed: boolean, closedMessage: string | null) =>
    supabase.rpc('set_auction_house_closed', {
      p_is_closed: isClosed,
      // The RPC param defaults to NULL; omit it (undefined) to clear the message
      // server-side rather than send an explicit null.
      p_closed_message: closedMessage ?? undefined,
    }),
}

// Auction money is plain pin_ledger rows tagged with auction_id. The player
// side of 'auction_check_bounce' rows is the public bounce story (name + fee
// — the pledged amount was destroyed at settlement and exists nowhere).
export const auctionLedger = {
  listBySeason: (seasonId: string) =>
    supabase.from('pin_ledger').select('auction_id, amount, type, is_house, players(name)')
      .eq('season_id', seasonId)
      .not('auction_id', 'is', null)
      .eq('is_house', false),
}

export interface CatalogItemRpcInput {
  name: string
  description: string
  icon: string
  effectType: string
  effectParams: Json
  activationMode: string
}

export const itemCatalog = {
  // Create-modal picker + item display copy. Catalog rows are admin-curated;
  // functional columns are frozen once instances exist (the update RPC enforces).
  listActive: () =>
    supabase.from('item_catalog').select('*').eq('is_active', true).order('created_at'),
  // Admin catalog list: every row (incl. retired) + instance count — count > 0
  // means the functional columns are frozen (the UI mirrors the DB guard).
  listAllWithCounts: () =>
    supabase.from('item_catalog').select('*, player_inventory_items(count)').order('created_at'),
  create: (key: string, c: CatalogItemRpcInput) =>
    supabase.rpc('create_catalog_item', {
      p_key: key,
      p_name: c.name,
      p_description: c.description,
      p_icon: c.icon,
      p_effect_type: c.effectType,
      p_effect_params: c.effectParams,
      p_activation_mode: c.activationMode,
    }),
  update: (catalogItemId: string, c: CatalogItemRpcInput, isActive: boolean) =>
    supabase.rpc('update_catalog_item', {
      p_catalog_item_id: catalogItemId,
      p_name: c.name,
      p_description: c.description,
      p_icon: c.icon,
      p_effect_type: c.effectType,
      p_effect_params: c.effectParams,
      p_activation_mode: c.activationMode,
      p_is_active: isActive,
    }),
}

export const inventoryItems = {
  // My Items: every atomic single-use row (active + spent) for the season;
  // grouping/sorting is pure compute (utils/auction.ts groupInventory).
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('player_inventory_items')
      .select('*, item_catalog(key, name, description, icon, effect_type, effect_params, activation_mode)')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .order('granted_at', { ascending: false }),
  grant: (playerId: string, catalogKey: string, quantity = 1) =>
    supabase.rpc('grant_inventory_item', {
      p_player_id: playerId, p_catalog_key: catalogKey, p_quantity: quantity,
    }),
  // Admin: every inventory row for the season across all players (RLS "owner or
  // admin can read inventory" lets admins see everyone). Powers the admin
  // remove-item view; player names join for grouping.
  listAllForSeason: (seasonId: string) =>
    supabase.from('player_inventory_items')
      .select('*, item_catalog(key, name, icon, effect_type), players!player_inventory_items_player_id_fkey(id, name)')
      .eq('season_id', seasonId)
      .order('granted_at', { ascending: false }),
  // Admin: hard-delete a single unconsumed inventory row (undo a bad grant).
  // The RPC refuses consumed/attached items; cascade-safe by construction.
  revoke: (itemId: string) =>
    supabase.rpc('revoke_inventory_item', { p_item_id: itemId }),
}
