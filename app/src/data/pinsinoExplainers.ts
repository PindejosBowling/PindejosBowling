// The single source of truth for Pinsino explanation copy. Everything that
// explains a game mechanic reads from here: the help screen accordions, the
// per-screen "?" explainer sheets, the hub tile hooks, and the TermsBlock
// bodies inside confirm sheets.
//
// Voice contract (two layers): `hook` lines carry the noir house persona;
// `bullets` and `terms.lines` are plain, dead-simple mechanics — one rule per
// line, no puns, no metaphors. "Pincome"/"pinterest" survive only as the one
// defined flavor aside in the Loan Shark bullets.

export type PinsinoFeatureKey =
  | 'sportsbook'
  | 'pvp'
  | 'bounties'
  | 'loanShark'
  | 'auctionHouse'
  | 'marketMoves'
  | 'items'

export interface FeatureExplainer {
  key: PinsinoFeatureKey
  icon: string
  title: string
  // Noir one-liner: collapsed accordion teaser + explainer-sheet subtitle.
  hook: string
  // Ultra-short (~≤28 chars) variant for the hub tile; falls back to `hook`.
  tileHook?: string
  // Plain-language mechanics, one rule per bullet.
  bullets: string[]
  // Optional gold italic note (the FeatureAccordion caveat idiom).
  caveat?: string
}

export const EXPLAINERS: Record<PinsinoFeatureKey, FeatureExplainer> = {
  sportsbook: {
    key: 'sportsbook',
    icon: '🏟️',
    title: 'Sportsbook',
    hook: 'Bet on the bowling.',
    tileHook: 'Bet your pins on the weekly lines',
    bullets: [
      'Back a player to beat their projected line for the week, or back your own team to win its matchup.',
      'Stack multiple picks into a parlay — every leg has to hit, but the payout multiplies.',
      'Pins leave your balance when you place a bet. Tickets settle automatically when the week is finalized — stat props once an admin confirms the lane data, sometimes a beat later.',
    ],
    caveat:
      'Scared money don\'t make no money - go big or go home!',
  },

  pvp: {
    key: 'pvp',
    icon: '⚔️',
    title: 'PvP Challenges',
    hook: 'Go head-to-head with a rival.',
    tileHook: 'Challenge another player directly',
    bullets: [
      'Send a challenge to a specific player, or post it to the open board for anyone to take.',
      'Both sides stake pins into escrow — the house holds them, and takes no cut.',
      'Winner takes the whole pot. It settles automatically off the week’s scores.',
      'Lose one? You can offer a double-or-nothing rematch.',
    ],
  },

  bounties: {
    key: 'bounties',
    icon: '🎯',
    title: 'Bounties',
    hook: "Hunt the house's challenges.",
    tileHook: 'Hunt house challenges',
    bullets: [
      'The house posts a bounty with a target — pay the entry to join the hunt.',
      'If any hunter pulls it off, every hunter cashes in: your stake back plus a locked-in reward.',
      'More hunters joining never shrinks your cut — your profit is set when you enter.',
    ],
    caveat: 'For now, bounties are posted and settled by the house.',
  },

  loanShark: {
    key: 'loanShark',
    icon: '🦈',
    title: 'Loan Shark',
    hook: 'Borrow now, bowl it off later.',
    tileHook: 'Borrow pins now, repay them later',
    bullets: [
      'Take a loan and the pins hit your balance instantly — ready to put into play.',
      'Each week, the shark takes his cut straight from your bowling: a fixed percentage of the pins you knock down that week goes toward the debt. (He calls those pins your "pincome.")',
      'After the cut, interest is added to whatever you still owe. Bowl every week and the debt shrinks; miss a week and it only grows.',
      'You can repay early, any amount, any time — no penalty.',
    ],
    caveat:
      'What counts is net worth: balance minus debt. At season close, anything you still owe comes out of your balance.',
  },

  auctionHouse: {
    key: 'auctionHouse',
    icon: '📣',
    title: 'Auction House',
    hook: 'Sealed-bid auctions for scarce goods.',
    tileHook: 'Spend your pins on powerful items',
    bullets: [
      'The house lists something rare. You submit a single hidden bid — nobody sees what anyone else pledged, only how many bids are in.',
      'When it closes, the highest bidder who can still cover their bid wins and pays it. Multiple units up for grabs? The top bids each take one — one win per player.',
      "Change your bid any time before the hammer falls — but once you're in, you're in. No taking it back.",
    ],
    caveat:
      'Bids are pledges, not held pins. Be able to cover yours at settlement, or take a small bounce penalty.',
  },

  marketMoves: {
    key: 'marketMoves',
    icon: '👀',
    title: 'Market Moves',
    hook: "The league's money newswire.",
    tileHook: "The league's newswire",
    bullets: [
      'A live feed of the notable action — big tickets, parlay hits, loans, settled challenges, and bounty and auction results.',
      'Tap any card to jump straight to the action behind it.',
    ],
  },

  items: {
    key: 'items',
    icon: '🎒',
    title: 'Items',
    hook: 'Rare tools, won at auction.',
    bullets: [
      'Items are single-use. Win one at auction and it sits in your inventory until you spend it — and using it spends it, win or lose.',
      'You can stack more than one item on the same Sportsbook bet — say a Golden Ticket and an Energy Drink together — as long as the bet qualifies for each.',
      '🎫 Golden Ticket — attach it to a bet: if the bet loses, your stake comes back. Insurance.',
      '⚡️ Energy Drink — attach it to a bet: if the bet wins, your total payout is doubled.',
      "🩼 Winner's Crutch — attach it to a parlay: miss by exactly one leg and that leg is forgiven; you cash the rest at reduced odds.",
      "👻 Ghost in the Slip — secretly attach it to another player's pending bet. If that bet wins, the ghosts take the profit and the bettor keeps only their stake.",
    ],
    caveat:
      'You only find out who haunted you if the ghost cashes. The house never tells.',
  },
}

// ---------------------------------------------------------------------------
// Terms — the standardized rules body for confirm flows, keyed by FLOW (one
// feature can have several). Lines are static rule statements; dynamic numbers
// (stakes, pots, bounce fees) stay in each sheet's own stat cells or are
// appended locally by the caller.

export interface TermsCopy {
  // Plain ELI5 rule lines, rendered by <TermsBlock />.
  lines: string[]
  // Optional gold caution line rendered after the rules.
  caution?: string
}

export type TermsKey =
  | 'loanBorrow'
  | 'pvpAccept'
  | 'pvpCreate'
  | 'bountyEnter'
  | 'auctionBid'
  | 'haunt'
  | 'betSlip'

export const TERMS: Record<TermsKey, TermsCopy> = {
  loanBorrow: {
    lines: [
      'The pins land in your balance the moment you confirm.',
      "Every week, the shark takes his cut of the pins you bowl that week and puts it toward the debt.",
      'Then weekly interest is added to whatever you still owe.',
      'Miss a week and nothing is garnished — but the interest still lands.',
      'Repay early, any amount, any time. No penalty.',
    ],
    caution: 'At season close, anything you still owe comes straight out of your balance.',
  },

  pvpAccept: {
    lines: [
      'Your stake leaves your balance the moment you accept, and the contract locks.',
      'The house holds both stakes in escrow and takes no cut.',
      "It settles automatically off the week's scores when the week is archived. Winner takes the whole pot.",
    ],
  },

  pvpCreate: {
    lines: [
      'Posting is free — no pins move until the challenge is accepted.',
      'When your opponent accepts, both stakes move into escrow and the contract locks.',
      'It settles automatically when the week is archived. Winner takes the whole pot — no house cut.',
    ],
  },

  bountyEnter: {
    lines: [
      'Your entry stake is locked in the moment you join.',
      'Every hunter gets the same flat reward — more hunters joining never shrinks your payout.',
      'If any hunter hits the target, every hunter wins: stake back plus the reward.',
    ],
    caution: 'Bounties are judged and settled by an admin after league night.',
  },

  auctionBid: {
    lines: [
      'A bid is a pledge — no pins leave your balance now.',
      'Nobody sees your number. You can change it any time until close, but you can never take it back.',
      "If you win, you pay your pledge at settlement. If you can't cover it by then, your check bounces and you pay a penalty instead.",
    ],
  },

  haunt: {
    lines: [
      'Your ghost is spent the moment you attach it, win or lose.',
      'If the bet wins, the haunters split the profit — the bettor keeps only their stake back.',
      'You stay invisible unless the bet wins. Losing ghosts are never revealed.',
    ],
  },

  betSlip: {
    lines: ['Pins come out of your balance now. Tickets settle when the week is archived.'],
  },
}
