-- Betting feature: bet_lines, placed_bets, pin_ledger
--
-- Balance lifecycle:
--   season start      → +100 (champion_bonus) for prior-season champions
--   week archived     → +actual_score (score_credit) per game per player
--   bet placed        → -wager (bet_placed)
--   bet settled win   → +wager*2 (bet_won); net gain = wager
--   bet settled push  → +wager (bet_push); full refund
--   bet settled loss  → nothing; wager already debited at placement

-- Bet lines: one row per player per game per week.
-- Auto-generated when admin confirms teams; auto-settled on week archive.
CREATE TABLE public.bet_lines (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id      uuid         NOT NULL REFERENCES public.weeks(id)   ON DELETE CASCADE,
  player_id    uuid         NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  game_number  integer      NOT NULL CHECK (game_number >= 1),
  line         numeric(5,1) NOT NULL,
  is_open      boolean      NOT NULL DEFAULT true,
  result       text         CHECK (result IN ('over', 'under', 'push')),
  actual_score integer,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (week_id, player_id, game_number)
);

-- Placed bets: one per player per bet line, min wager 10 pins.
-- Even odds: win = payout 2×wager, push = payout wager, loss = payout 0.
CREATE TABLE public.placed_bets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid        NOT NULL REFERENCES public.players(id)   ON DELETE CASCADE,
  bet_line_id uuid        NOT NULL REFERENCES public.bet_lines(id) ON DELETE CASCADE,
  pick        text        NOT NULL CHECK (pick IN ('over', 'under')),
  wager       integer     NOT NULL CHECK (wager >= 10),
  payout      integer,
  settled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, bet_line_id)
);

-- Pin ledger: append-only event log; balance = SUM(amount) for player + season.
CREATE TABLE public.pin_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid        NOT NULL REFERENCES public.players(id)    ON DELETE CASCADE,
  season_id     uuid        NOT NULL REFERENCES public.seasons(id)    ON DELETE CASCADE,
  amount        integer     NOT NULL,
  type          text        NOT NULL CHECK (type IN ('champion_bonus', 'score_credit', 'bet_placed', 'bet_won', 'bet_push')),
  description   text        NOT NULL,
  placed_bet_id uuid        REFERENCES public.placed_bets(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bet_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placed_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_ledger  ENABLE ROW LEVEL SECURITY;

-- Read: open to all (matches existing table pattern)
CREATE POLICY "anon can read"          ON public.bet_lines   FOR SELECT TO anon          USING (true);
CREATE POLICY "authenticated can read" ON public.bet_lines   FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon can read"          ON public.placed_bets FOR SELECT TO anon          USING (true);
CREATE POLICY "authenticated can read" ON public.placed_bets FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon can read"          ON public.pin_ledger  FOR SELECT TO anon          USING (true);
CREATE POLICY "authenticated can read" ON public.pin_ledger  FOR SELECT TO authenticated USING (true);

-- Write: open to authenticated/anon (matches existing table pattern)
CREATE POLICY "anon can insert"          ON public.bet_lines   FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "anon can update"          ON public.bet_lines   FOR UPDATE TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "authenticated can insert" ON public.bet_lines   FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated can update" ON public.bet_lines   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon can insert"          ON public.placed_bets FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "anon can update"          ON public.placed_bets FOR UPDATE TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "authenticated can insert" ON public.placed_bets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated can update" ON public.placed_bets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon can insert"          ON public.pin_ledger  FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "authenticated can insert" ON public.pin_ledger  FOR INSERT TO authenticated WITH CHECK (true);
