// UI visibility flags. When SHOW_PINSINO is false the Pinsino tab and the
// Pinsino Admin tile are hidden from navigation; all routes, screens, and
// data stay registered and functional.
export const SHOW_PINSINO = true

// Auction House tile inside Pinsino. Gated independently of SHOW_PINSINO so
// Pinsino can re-ship without leaking a half-wired Auction House.
export const SHOW_AUCTION_HOUSE = true

// Pixel-art backdrop + header Artwork reveal button on the Pinsino landing
// page. When false the landing page renders on a plain background and the
// reveal toggle is hidden; subpage backdrops (Sportsbook, Loan Shark, …) are
// unaffected. Flip to true to restore the art.
export const SHOW_PINSINO_ART = false

// Screenshot/demo switch. When true, every player name returned from Supabase
// is replaced with a deterministic fictitious name before it reaches the UI,
// so App Store / marketing screenshots contain no real PII. The same real
// player always maps to the same fake name, so relationships stay coherent
// across standings, matchups, the activity feed, etc. Display-only transform on
// read responses — no writes, no database changes. Flip to false for normal
// operation. Applied centrally in app/src/utils/supabase/client.ts via
// redactPlayerNames(); see app/src/utils/demoNames.ts.
export const DEMO_NAMES = false

// Temporary compliance switch. When true, OTP login is disabled: the app
// auto-signs-in to a single read-only "guest" account (so authenticated reads
// + avatars keep working) and forces global read-only mode — every write
// affordance is hidden/disabled and any reachable write no-ops with a toast.
// Flip back to false to restore normal phone-OTP login and all write paths;
// no database changes are involved. Requires EXPO_PUBLIC_GUEST_EMAIL /
// EXPO_PUBLIC_GUEST_PASSWORD. See app/src/stores/authStore.ts (guest auto-login)
// and app/src/utils/supabase/client.ts (central write block).
export const READ_ONLY_MODE = false
