// Activity Feed ("Market Moves") — the single place feed copy lives (design §7,
// §9). Feed rows store NO rendered text: they carry a `template_key` + a
// league-safe `public_payload`, and the copy is rendered here from the *current*
// joined player names + payload values. Keeping copy in app code (not the DB row)
// means tone/format can evolve without rewriting historical rows (§3.7).
//
// Rules baked in: short, playful, public-safe, non-shaming copy (§9.1); loan copy
// exposes NO amounts (§11); feed lines avoid subject/market targeting — "{actor}
// placed a ticket", never "{actor} bet the under on {subject}" (§10.2). Detailed
// subject references belong on tap-through detail pages only.

// Normalized feed row consumed by the renderer + the screens. Produced by
// useMarketMovesData from a joined activity_feed_events row (names are live, not
// snapshotted). NO rendered text — rendering is renderFeedEvent's job.
export interface FeedEventView {
  id: string
  seasonId: string
  weekId: string | null
  sourceFeature: string
  eventType: string
  templateKey: string
  importance: string
  status: string
  visibility: string
  publicPayload: Record<string, any>
  adminPayload: Record<string, any> // surfaced only on the admin screen (§8.2)
  publishedAt: string
  occurredAt: string
  // Joined player names/avatar (live from the players table, never snapshotted).
  actorPlayerId: string | null
  actorName: string | null
  actorAvatarPath: string | null
  subjectPlayerId: string | null
  subjectName: string | null
  secondaryPlayerId: string | null
  secondaryName: string | null
  // Concrete source FKs (drive privacy-aware tap-through).
  sportsbookBetId: string | null
  loanId: string | null
  pvpChallengeId: string | null
  // Admin moderation metadata.
  suppressionReason: string | null
}

export interface FeedRenderParts {
  icon: string // feature emoji
  sourceLabel: string // "Sportsbook" | "Loan Shark" | "The House"
  line: string // rendered sentence
  // Optional pin badge. `label` names what the figure is (e.g. "TO WIN", "WON")
  // so the amount is never ambiguous on the card.
  amount?: { value: number; tone: 'positive' | 'neutral'; label?: string }
  // Set on a victory event (e.g. a PvP win) to give the card a prominent winner
  // treatment — a 🏆 banner + accent framing — with the champion's name.
  winner?: { name: string }
}

// Feature → icon + source label. Centralized so every renderer (and the admin
// screen) reads the same mapping.
const FEATURE_META: Record<string, { icon: string; sourceLabel: string }> = {
  sportsbook: { icon: '🏟️', sourceLabel: 'Sportsbook' },
  loan_shark: { icon: '🦈', sourceLabel: 'Loan Shark' },
  pvp: { icon: '⚔️', sourceLabel: 'PvP' },
  system: { icon: '🏛️', sourceLabel: 'The House' },
  admin: { icon: '📊', sourceLabel: 'The House' },
}

function featureMeta(sourceFeature: string): { icon: string; sourceLabel: string } {
  return FEATURE_META[sourceFeature] ?? { icon: '📊', sourceLabel: 'Pinsino' }
}

const actorOf = (row: FeedEventView): string => row.actorName ?? 'A player'
const secondaryOf = (row: FeedEventView): string => row.secondaryName ?? 'their opponent'
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

// Placement badge = the bet's total potential payout (the "to win" figure),
// labeled so it's never mistaken for the stake. Rows published before the payout
// was added to public_payload fall back to the stake.
function placementPayout(p: Record<string, any>): FeedRenderParts['amount'] {
  return { value: num(p.payout) || num(p.stake), tone: 'neutral', label: 'TO WIN' }
}

// Loan copy varies by the product's risk tier (low | medium | high | extreme) to
// suggest how dangerous the deal was — while still exposing NO amounts (§11). An
// unknown/missing tier (e.g. rows published before risk_level was added) falls
// back to the original vague line.
const LOAN_TAKEN_BY_RISK: Record<string, (a: string) => string> = {
  low: a => `${a} grabbed a little something from the Loan Shark.`,
  medium: a => `${a} shook hands with the Loan Shark.`,
  high: a => `${a} cut a risky deal with the Loan Shark.`,
  extreme: a => `${a} signed something they really shouldn't have with the Loan Shark.`,
}
const LOAN_REPAID_BY_RISK: Record<string, (a: string) => string> = {
  low: a => `${a} quietly squared up with the Loan Shark.`,
  medium: a => `${a} paid off the Loan Shark.`,
  high: a => `${a} bought their way out of a dangerous deal with the Loan Shark.`,
  extreme: a => `${a} somehow walked away from the Loan Shark in one piece.`,
}
function loanTakenLine(actor: string, risk: unknown): string {
  const fn = typeof risk === 'string' ? LOAN_TAKEN_BY_RISK[risk] : undefined
  return fn ? fn(actor) : `${actor} visited the Loan Shark.`
}
function loanRepaidLine(actor: string, risk: unknown): string {
  const fn = typeof risk === 'string' ? LOAN_REPAID_BY_RISK[risk] : undefined
  return fn ? fn(actor) : `${actor} cleared things up with the Loan Shark.`
}

// Render a feed row into display parts. Switches on template_key; an unknown key
// falls back to a safe generic line so future server-side publishers never crash
// an older client (forward-compatible, §2).
export function renderFeedEvent(row: FeedEventView): FeedRenderParts {
  const meta = featureMeta(row.sourceFeature)
  const p = row.publicPayload ?? {}

  switch (row.templateKey) {
    case 'sportsbook.bet_placed':
      // Off in v1 (normal placements post nothing); rendered for completeness.
      // Placement badge = the total potential payout (the "to win" figure).
      return {
        ...meta,
        line: `${actorOf(row)} placed a Sportsbook ticket.`,
        amount: placementPayout(p),
      }

    case 'sportsbook.parlay_placed':
      return {
        ...meta,
        line: `${actorOf(row)} built a ${num(p.legs)}-leg parlay.`,
        amount: placementPayout(p),
      }

    case 'sportsbook.big_ticket_placed':
      return {
        ...meta,
        line: `${actorOf(row)} put ${num(p.stake).toLocaleString()} pins on the board.`,
        amount: placementPayout(p),
      }

    case 'sportsbook.big_win':
      return {
        ...meta,
        line: `${actorOf(row)} hit big at the Sportsbook and took home ${num(p.payout).toLocaleString()} pins.`,
        amount: { value: num(p.payout), tone: 'positive', label: 'WON' },
      }

    case 'sportsbook.parlay_hit':
      return {
        ...meta,
        line: `${actorOf(row)} hit a ${num(p.legs)}-leg parlay and won ${num(p.payout).toLocaleString()} pins.`,
        amount: { value: num(p.payout), tone: 'positive', label: 'WON' },
      }

    case 'sportsbook.weekly_house_result': {
      const houseNet = num(p.house_net)
      const line =
        houseNet > 0
          ? `The House cleaned up this week: +${houseNet.toLocaleString()} pins.`
          : houseNet < 0
            ? `The players beat the House this week: ${houseNet.toLocaleString()} for the Sportsbook.`
            : 'The House and the players broke even this week.'
      return { icon: '🏛️', sourceLabel: 'The House', line }
    }

    case 'loan_shark.loan_taken':
      // Deliberately vague — NO amounts (§11). Copy varies by the product's risk
      // tier to hint at the kind of deal that went down.
      return { ...meta, line: loanTakenLine(actorOf(row), p.risk_level) }

    case 'loan_shark.loan_repaid':
      return { ...meta, line: loanRepaidLine(actorOf(row), p.risk_level) }

    case 'pvp.challenge_accepted':
      // Two players locked in. Pot is public (shown on the Challenge Board).
      return {
        ...meta,
        line: `${actorOf(row)} and ${secondaryOf(row)} locked in a PvP challenge.`,
        amount: num(p.pot) ? { value: num(p.pot), tone: 'neutral', label: 'POT' } : undefined,
      }

    case 'pvp.challenge_settled':
      // Neutral copy — the gold WINNER banner (below) calls out the champion, so
      // the line just names the matchup. Push = a draw (no winner). Otherwise the
      // actor IS the winner (set server-side): their avatar leads + a WON badge.
      return p.outcome === 'push'
        ? { ...meta, line: `A PvP challenge between ${actorOf(row)} and ${secondaryOf(row)} ended in a draw.` }
        : {
            ...meta,
            line: `A PvP challenge between ${actorOf(row)} and ${secondaryOf(row)} has been settled.`,
            amount: { value: num(p.pot), tone: 'positive', label: 'WON' },
            winner: { name: actorOf(row) },
          }

    case 'loan_shark.special_offer':
      // Posted as a system/admin event, but it reads as a Loan Shark move — force
      // the 🦈 meta over the generic House meta its source_feature would give.
      return {
        ...featureMeta('loan_shark'),
        line: 'The Loan Shark is offering dangerous terms this week.',
      }

    default:
      // Unknown template_key (a newer publisher) — safe generic line.
      return { ...meta, line: `${actorOf(row)} made a move on the ${meta.sourceLabel}.` }
  }
}
