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
  bountySourceId: string | null
  auctionSourceId: string | null
  // Admin moderation metadata.
  suppressionReason: string | null
}

// ── Importance (Market Moves owns this, not the DB) ──────────────────────────
// Importance is a derived property of the event type, NOT a stored column. Like
// feed copy, it lives in app code so what counts as a "highlight" can evolve
// without an RPC change or rewriting historical rows. `importanceForEvent` is the
// single source of truth; the publish RPC no longer computes or stores it.
export type Importance = 'low' | 'normal' | 'highlight' | 'major'

// Only the non-default tiers are listed; everything else falls through to 'normal'
// (e.g. sportsbook_parlay_placed, loan_shark_loan_taken/special_offer,
// pvp_challenge_accepted, bounty_board_bounty_closed).
const EVENT_IMPORTANCE: Record<string, Importance> = {
  sportsbook_bet_placed: 'low',
  bounty_board_hunter_joined: 'low',

  sportsbook_big_ticket_placed: 'highlight',
  sportsbook_big_win: 'highlight',
  sportsbook_parlay_hit: 'highlight',
  sportsbook_crutch_save: 'highlight',
  sportsbook_boost_hit: 'highlight',
  sportsbook_haunt_hit: 'highlight',
  loan_shark_loan_repaid: 'highlight',
  pvp_challenge_settled: 'highlight',
  bounty_board_bounty_posted: 'highlight',
  bounty_board_sponsor_won: 'highlight',
  bounty_board_hunters_won: 'highlight',
  auction_opened: 'highlight',
  auction_won: 'highlight',
  auction_check_bounce: 'highlight',
  admin_bonus_issued: 'highlight',

  sportsbook_weekly_house_result: 'major',
}

export function importanceForEvent(eventType: string): Importance {
  return EVENT_IMPORTANCE[eventType] ?? 'normal'
}

// Event types that surface under the Market Moves "Highlights" filter. Derived
// from the map so it can never drift from importanceForEvent.
export const HIGHLIGHT_EVENT_TYPES: string[] = Object.entries(EVENT_IMPORTANCE)
  .filter(([, v]) => v === 'highlight' || v === 'major')
  .map(([k]) => k)

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
  bounty_board: { icon: '🎯', sourceLabel: 'Bounty Board' },
  auction_house: { icon: '🔨', sourceLabel: 'Auction House' },
  system: { icon: '🏛️', sourceLabel: 'The House' },
  admin: { icon: '📊', sourceLabel: 'The House' },
}

export function featureMeta(sourceFeature: string): { icon: string; sourceLabel: string } {
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

    case 'sportsbook.crutch_save':
      // The Winner's Crutch cancelled the one losing leg and salvaged a payout.
      return {
        ...meta,
        line: `${actorOf(row)}'s parlay missed by a leg — the Winner's Crutch 🩼 salvaged ${num(p.payout).toLocaleString()} pins.`,
        amount: { value: num(p.payout), tone: 'positive', label: 'SAVED' },
      }

    case 'sportsbook.boost_hit':
      // An Energy Drink doubled the total payout on a winning bet (House-funded bonus).
      return {
        ...meta,
        line: `${actorOf(row)} cracked an Energy Drink ⚡️ and doubled their total payout — a ${num(p.bonus).toLocaleString()}-pin bonus on top.`,
        amount: { value: num(p.bonus), tone: 'positive', label: 'BONUS' },
      }

    case 'sportsbook.haunt_hit': {
      // A Ghost in the Slip cashed: the bettor's winning bet had its profit stolen
      // by one or more secretly-attached ghosts. Subject = the victim; the haunters
      // ride in the payload (a feed row has a single subject). The drama of a
      // successful haunt is the whole point — name everyone involved.
      const victim = row.subjectName ?? 'A player'
      const ghosts: any[] = Array.isArray(p.haunters) ? p.haunters : []
      const names = ghosts.map(g => g?.name).filter(Boolean)
      const who =
        names.length === 0
          ? 'A ghost'
          : names.length === 1
            ? names[0]
            : names.length === 2
              ? `${names[0]} and ${names[1]}`
              : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
      const verb = ghosts.length > 1 ? 'slipped in and split' : 'slipped in and took'
      return {
        ...meta,
        line: `👻 ${victim}'s winning bet was haunted — ${who} ${verb} ${num(p.profit).toLocaleString()} pins. They kept only their stake.`,
        amount: { value: num(p.profit), tone: 'positive', label: 'STOLEN' },
      }
    }

    case 'sportsbook.weekly_house_result': {
      const houseNet = num(p.house_net)
      const line =
        houseNet > 0
          ? `The House cleaned up this week: +${houseNet.toLocaleString()} pins.`
          : houseNet < 0
            ? `The players beat the House this week: ${houseNet.toLocaleString()} pins.`
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

    case 'bounty_board.bounty_posted': {
      // House bounties have no actor → the Pinsino is the poster.
      const poster = row.actorName ?? 'The Pinsino'
      const title = p.bounty_title ? `: "${p.bounty_title}"` : '.'
      return { ...meta, line: `${poster} posted a bounty${title}` }
    }

    case 'bounty_board.hunter_joined':
      return {
        ...meta,
        line: p.bounty_title
          ? `${actorOf(row)} joined the hunt on "${p.bounty_title}."`
          : `${actorOf(row)} joined the hunt.`,
      }

    case 'bounty_board.bounty_closed':
      return {
        ...meta,
        line: p.bounty_title
          ? `The bounty "${p.bounty_title}" stopped taking hunters.`
          : 'A bounty stopped taking hunters.',
      }

    case 'bounty_board.sponsor_won': {
      const poster = row.actorName ?? 'The Pinsino'
      return {
        ...meta,
        line: p.bounty_title
          ? `${poster} survived the hunt on "${p.bounty_title}."`
          : `${poster} survived the hunt.`,
        amount: num(p.total_pot) ? { value: num(p.total_pot), tone: 'positive', label: 'POT' } : undefined,
      }
    }

    case 'bounty_board.hunters_won':
      return {
        ...meta,
        line: p.bounty_title
          ? `The hunters got paid on "${p.bounty_title}."`
          : 'The hunters got paid.',
        amount: num(p.total_pot) ? { value: num(p.total_pot), tone: 'positive', label: 'POT' } : undefined,
      }

    case 'auction_house.opened': {
      const item = p.item_name ? `${p.item_icon ?? ''} ${p.item_name}`.trim() : 'something rare'
      return {
        ...meta,
        line: `The House put ${item} on the block. Sealed bids only.`,
        amount: num(p.minimum_bid) ? { value: num(p.minimum_bid), tone: 'neutral', label: 'MIN BID' } : undefined,
      }
    }

    case 'auction_house.won':
      return {
        ...meta,
        line: p.item_name
          ? `${actorOf(row)} won the ${p.item_name} at auction.`
          : `${actorOf(row)} won at auction.`,
        amount: num(p.price) ? { value: num(p.price), tone: 'neutral', label: 'PAID' } : undefined,
        winner: { name: actorOf(row) },
      }

    case 'auction_house.check_bounce':
      // Fee, never the pledged amount (the pledge was destroyed at settlement).
      // fee 0 = they couldn't even cover the penalty — say so.
      return {
        ...meta,
        line: num(p.fee) > 0
          ? `${actorOf(row)}'s check BOUNCED at the auction house. 💸`
          : `${actorOf(row)}'s check bounced — and there was nothing left to collect.`,
        amount: num(p.fee) ? { value: num(p.fee), tone: 'neutral', label: 'FEE' } : undefined,
      }

    case 'auction_house.no_sale': {
      const item = p.item_name ? `the ${p.item_name}` : 'the item'
      // The ironic all-bounce special case: bids existed and every single one
      // bounced (FINDINGS §11 — counts snapshotted at settlement).
      const allBounced = num(p.bounce_count) > 0 && num(p.bounce_count) === num(p.bidder_count)
      return {
        ...meta,
        line: allBounced
          ? `Every single pledge for ${item} bounced. The House keeps it — and the fees.`
          : num(p.bidder_count) === 0
            ? `No takers — ${item} goes unsold. Cowards.`
            : `No valid bids survived — ${item} goes unsold.`,
      }
    }

    case 'loan_shark.special_offer':
      // Posted as a system/admin event, but it reads as a Loan Shark move — force
      // the 🦈 meta over the generic House meta its source_feature would give.
      return {
        ...featureMeta('loan_shark'),
        line: 'The Loan Shark is offering dangerous terms this week.',
      }

    case 'admin.bonus_issued': {
      // A House-issued bonus (e.g. a Reigning Champion prize). Subject = the
      // recipient; the amount is public (bonuses aren't privacy-sensitive).
      const recipient = row.subjectName ?? 'A player'
      const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : 'a bonus'
      return {
        ...meta,
        line: `The House awarded ${recipient} ${num(p.amount).toLocaleString()} pins — ${label}. 🎉`,
        amount: { value: num(p.amount), tone: 'positive', label: 'BONUS' },
      }
    }

    default:
      // Unknown template_key (a newer publisher) — safe generic line.
      return { ...meta, line: `${actorOf(row)} made a move on the ${meta.sourceLabel}.` }
  }
}
