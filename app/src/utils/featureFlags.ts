// UI visibility flags. When SHOW_PINSINO is false the Pinsino tab and the
// Pinsino Admin tile are hidden from navigation; all routes, screens, and
// data stay registered and functional.
export const SHOW_PINSINO = false

// Auction House tile inside Pinsino. Gated independently of SHOW_PINSINO so
// Pinsino can re-ship without leaking a half-wired Auction House.
export const SHOW_AUCTION_HOUSE = true
