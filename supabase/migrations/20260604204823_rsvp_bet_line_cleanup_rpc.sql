-- RSVP-driven bet-line cleanup.
--
-- When a player stops being "in" for a week, their bet lines must be removed and
-- any bets placed on those lines refunded "as if never placed" (delete every
-- ledger row tied to the bet, then the bet, then the line).
--
-- bet_lines has no DELETE RLS policy (deletes are blocked for everyone), and
-- placed_bets / pin_ledger DELETE is admin-only. But RsvpScreen lets a non-admin
-- toggle their *own* RSVP, which can require refunding *other* players' bets on
-- that line. A SECURITY DEFINER function performs the privileged cleanup
-- atomically, bypassing those RLS restrictions.
--
-- Order matters: delete pin_ledger first (pin_ledger.placed_bet_id is
-- ON DELETE SET NULL, so deleting the bet first would orphan its ledger rows and
-- lose the refund), then placed_bets, then bet_lines.

create or replace function public.cancel_bet_lines_for_players(
  p_week_id uuid,
  p_player_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_player_ids is null or array_length(p_player_ids, 1) is null then
    return;
  end if;

  delete from pin_ledger pl
    using placed_bets pb, bet_lines bl
    where pl.placed_bet_id = pb.id
      and pb.bet_line_id = bl.id
      and bl.week_id = p_week_id
      and bl.player_id = any(p_player_ids);

  delete from placed_bets pb
    using bet_lines bl
    where pb.bet_line_id = bl.id
      and bl.week_id = p_week_id
      and bl.player_id = any(p_player_ids);

  delete from bet_lines
    where week_id = p_week_id
      and player_id = any(p_player_ids);
end;
$$;

grant execute on function public.cancel_bet_lines_for_players(uuid, uuid[]) to authenticated, anon;
