// UI visibility flags. When SHOW_PINSINO is false the Pinsino tab and the
// Pinsino Admin tile are hidden from navigation; all routes, screens, and
// data stay registered and functional.
export const SHOW_PINSINO = false

// Auction House tile inside Pinsino. Gated independently of SHOW_PINSINO so
// Pinsino can re-ship without leaking a half-wired Auction House.
export const SHOW_AUCTION_HOUSE = true

// Temporary compliance switch. When true, OTP login is disabled: the app
// auto-signs-in to a single read-only "guest" account (so authenticated reads
// + avatars keep working) and forces global read-only mode — every write
// affordance is hidden/disabled and any reachable write no-ops with a toast.
// Flip back to false to restore normal phone-OTP login and all write paths;
// no database changes are involved. Requires EXPO_PUBLIC_GUEST_EMAIL /
// EXPO_PUBLIC_GUEST_PASSWORD. See app/src/stores/authStore.ts (guest auto-login)
// and app/src/utils/supabase/client.ts (central write block).
export const READ_ONLY_MODE = true
