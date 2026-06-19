// Deterministic fake-name substitution for App Store / marketing screenshots.
//
// Gated by DEMO_NAMES (see featureFlags.ts) and wired into the Supabase client's
// fetch wrapper (client.ts) so it covers EVERY screen with no per-call-site
// edits — the whole point is that you can't forget to redact a screen.
//
// Player names reach the app two ways, and both are handled:
//   1. Top-level `players` rows (e.g. players.getAll) — carry `first_name`.
//   2. Joined player objects under an alias — e.g. `subject:players(name)`,
//      `actor:players(first_name)`, `picked:players(id, name)`. These select
//      DIFFERENT column subsets, so we can't rely on any one column being
//      present; instead we recognise them by the join KEY (PLAYER_KEYS).
//
// Fake names are well-known fictional characters so the data reads as OBVIOUSLY
// not real. A person is mapped to a whole character (first + last together),
// keyed off their real first-name token — the only field common to every
// representation (the activity feed exposes just `first_name`, while standings
// and PvP expose a full `name`). Keying off the first name keeps the same person
// consistent across all screens. Caveat: two real players who share a first name
// will map to the same character — fine for demo screenshots.
const CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['Harry', 'Potter'], ['Hermione', 'Granger'], ['Ron', 'Weasley'],
  ['Luke', 'Skywalker'], ['Leia', 'Organa'], ['Han', 'Solo'],
  ['Tony', 'Stark'], ['Bruce', 'Wayne'], ['Clark', 'Kent'],
  ['Peter', 'Parker'], ['Diana', 'Prince'], ['Walter', 'White'],
  ['Michael', 'Scott'], ['Sherlock', 'Holmes'], ['John', 'Watson'],
  ['Tyrion', 'Lannister'], ['Daenerys', 'Targaryen'], ['Jon', 'Snow'],
  ['Arya', 'Stark'], ['Frodo', 'Baggins'], ['Gandalf', 'Grey'],
  ['Katniss', 'Everdeen'], ['Marty', 'McFly'], ['Indiana', 'Jones'],
  ['Ellen', 'Ripley'], ['Sarah', 'Connor'], ['Forrest', 'Gump'],
  ['Vito', 'Corleone'], ['Jack', 'Sparrow'], ['Rick', 'Deckard'],
  ['Ferris', 'Bueller'], ['Dana', 'Scully'], ['Fox', 'Mulder'],
  ['Jules', 'Winnfield'], ['Lara', 'Croft'], ['Neo', 'Anderson'],
  ['Atticus', 'Finch'], ['Bilbo', 'Baggins'], ['Aragorn', 'Elessar'],
  ['Willy', 'Wonka'],
]

// JSON keys under which a player record (or array of them) is nested. These are
// the join aliases used in db.ts player selects (`<alias>:players(...)`), plus
// the bare `players` relation. Keep in sync if a new player join alias is added.
const PLAYER_KEYS = new Set([
  'players', 'player', 'actor', 'subject', 'secondary',
  'counterparty', 'creator', 'offerer', 'picked', 'sponsor', 'winner',
])

// djb2 — small, stable string hash. Lower-cased so case variants collide
// (intended: same real token -> same fake token regardless of casing).
function hash(s: string): number {
  let h = 5381
  const lower = s.toLowerCase()
  for (let i = 0; i < lower.length; i++) {
    h = ((h << 5) + h + lower.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

const characterFor = (token: string) => CHARACTERS[hash(token) % CHARACTERS.length]

// Rewrites whatever name columns a player object carries, mapping the player to
// a single fictional character keyed off their real first-name token.
function redactPlayerObject(obj: Record<string, unknown>): void {
  const token =
    typeof obj.first_name === 'string' ? obj.first_name
    : typeof obj.name === 'string' ? obj.name.trim().split(/\s+/)[0]
    : typeof obj.last_name === 'string' ? (obj.last_name as string)
    : ''
  if (token === '') return

  const [first, last] = characterFor(token)
  if (typeof obj.first_name === 'string') obj.first_name = first
  if (typeof obj.last_name === 'string') obj.last_name = last
  if (typeof obj.name === 'string') obj.name = `${first} ${last}`
}

// Treat an object as a player record if it carries `first_name` OR it was
// reached via a player join alias (covers name-only joins like standings).
function isPlayerRecord(obj: Record<string, unknown>, key?: string): boolean {
  return typeof obj.first_name === 'string' || (key !== undefined && PLAYER_KEYS.has(key))
}

// Walks an arbitrary parsed-JSON value in place. `key` is the property name the
// value sits under (undefined at the root), used to detect aliased player joins.
// Non-player objects (teams.name, loan_products.display_name, …) and scalars
// pass through untouched.
export function redactPlayerNames(value: unknown, key?: string): void {
  if (Array.isArray(value)) {
    // Elements inherit the parent key so `subject:players(name)` arrays redact.
    for (const item of value) redactPlayerNames(item, key)
    return
  }
  if (value === null || typeof value !== 'object') return

  const obj = value as Record<string, unknown>
  if (isPlayerRecord(obj, key)) redactPlayerObject(obj)

  for (const k of Object.keys(obj)) redactPlayerNames(obj[k], k)
}
