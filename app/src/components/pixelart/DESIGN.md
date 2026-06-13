# Pinsino Pixel Art — Design Direction

The brief for anyone (human or agent) producing backdrop art for the Pindejos app. Read this before drawing a single pixel. The technical contract lives in [config.ts](config.ts); this document is the *vibe*.

## The one-line brief

**A grimy, glamorous retro casino seen out of the corner of your eye.** 16-bit pixel art that makes a recreational bowling league's fake economy feel like a place — glitzy on the surface, faintly dangerous underneath — without ever competing with the UI sitting on top of it.

## What this art is (and isn't)

- It is **ambience, not illustration**. The art lives *behind* live screens at whisper-quiet opacity (8–22%, see the `BACKDROP_OPACITY` ladder). A player should use the app for a week before noticing the red eyes in the Loan Shark's abyss. Discovery is the reward; nothing begs for attention.
- It is **a complement to a flat design system, not a replacement**. The app is dark (#0a0a0c), flat, high-contrast, typography-driven (Barlow / Barlow Condensed). The art adds warmth and story to that austerity — it must never add noise, gradients-for-their-own-sake, or visual competition with cards and tables.
- It is **deadpan, never cute**. The league runs on trash talk and fake money. The art's humor is dry: a wanted poster with no name on it, dice abandoned in desert sand, a shark fin that's just *there*. No mascots, no winking, no foreground characters.
- It is **never interactive and never textual**. `pointerEvents="none"` always. No readable words anywhere — odds boards glow with deliberately unreadable pixel noise. The UI does the talking.

## The two moods (always both)

Every scene mixes the same two ingredients:

1. **Glitz** — the casino promise. Gold bulbs, electric-lime neon, sparkles, marquee shapes, stacked chips, glowing scoreboards. Rendered in the brand's two precious colors: gold `#f4d03f` and lime `#e8ff47`. Use them like neon signage in a dark room: small, bright, deliberate.
2. **Menace** — the fine print. Something in every scene quietly reminds you the house always wins: a pair of red eyes (`#ff4f6d`) in the dark, a shark fin, deepening water, a snake in the sand, darkness pooling at the bottom edge. Menace is *small and patient* — one or two pixels of red go a very long way at 12% opacity.

The shorthand we've used: **desert noir** (Pinsino landing) and **grimy retro casino** (Sportsbook). Both are the same world: a neon oasis somewhere remote, where it's always night.

## Palette (hard constraint)

All color comes from theme tokens — never invent hexes. From `src/theme.ts`:

| Role | Token | Hex | Use |
|---|---|---|---|
| Glitz primary | `colors.gold` | `#f4d03f` | bulbs, stars, pins-as-chips, orbit rings |
| Glitz electric | `colors.accent` | `#e8ff47` | neon shapes, slips, glowing dots |
| Menace | `colors.danger` | `#ff4f6d` | eyes, rare glints — pixels, not shapes |
| Bright detail | `colors.text` | `#f0f0f0` | stars, dice, bone-white accents (sparingly) |
| Structure | `colors.surface3`, `colors.muted2`, `colors.muted` | charcoals/grays | frames, counters, silhouettes, dust |
| Soft tints | `colors.pixelArt.*` | teal `#6fa8a3` · purple `#8d7fb8` · rose `#c2899c` · sand `#c4ad85` · wood `#5c4433` | the desaturated "art" layer: dunes, water, cacti, moons, table rails |

The soft `pixelArt` tints carry most of the area; gold/lime/red carry the accents. A scene that's mostly gold is wrong. A scene with no gold at all is probably also wrong.

## Composition grammar

- **The center belongs to the UI.** Cards and tables float over the middle of the screen — motifs hug edges, corners, the top sky, the bottom ground. Full-bleed fields thin their speckle dramatically (~25–30% density) in the central column.
- **Two scene shapes:**
  - *Anchored scenes* — small fixed compositions (a wanted poster top-right, a gavel bottom-right, a skyline along the bottom). One iconic silhouette per screen domain.
  - *Procedural fields* — full-viewport or full-scroll-length atmospheres (starfields, dunes, water columns, dust) generated per-device-size with deterministic hashing, with sprites stamped on top.
- **Tell the screen's story spatially.** The best scenes map *meaning* onto *position*: the Loan Shark page is a dive — beach at the top, abyss at the bottom, menace increasing with loan risk as you scroll. Look for that mapping before settling for decoration.
- **One silhouette, instantly readable.** Sprites are tiny (4–16 px across). Iconic shapes only: pin, ball, fin, cactus, gavel, poster, podium, moon. If a sprite needs explaining, redraw it.
- **Minimal beats maximal.** The first desert-noir draft had a Vegas sign, skull, dice, snake, two cacti, and dunes — it was rejected as overwhelming. The shipped version: stars, moon, one diamond, one cactus, two red eyes. When in doubt, remove.

## Per-screen world (current scenes)

| Screen | Scene | Story |
|---|---|---|
| Pinsino landing | Minimal desert noir: starfield, moon, neon diamond, lone saguaro on a dune ridge, red eyes | The approach to the casino — empty desert, something watching |
| Sportsbook | Scroll-length nine-seat poker table seen from above: dark wooden rail wrapping the whole page (rounded corners, felt line inside), seat cushions around the rail dressed with trinkets — cards, chip stacks, a martini, dice, the dealer button — eyes under the table | The page is the table; the lines play out on the felt |
| Loan Shark | Scroll-length dive: beach → surf → shallows → fins → deep → abyss with eyes | Risk literally deepens as you scroll toward the worse loans |
| Market Moves | City skyline, lit windows, zigzag ticker with an up-arrow | The financial district of a town that shouldn't have one |
| PvP | Texas shootout at midnight (full-viewport hero field): bezel-to-ground starfield with a shooting star, one bright star, and buzzards circling; two gunslinger pins drawn down across an empty street, gold holster glints, tumbleweed, saguaro, red eyes on the ridge | High-noon duel, hours after midnight |
| Bounties | Blank wanted poster, sheriff-star centerpiece | Old-west job board |
| Auction House | Gavel mid-strike, sparks, sound block | The hammer falling |

New screens should extend this world — same night, same town, new corner of it.

## Craft & technical contract

- **Format:** pixel grids — arrays of equal-length strings, one char per cell keyed into a palette map, `'.'` = transparent — rendered as SVG rects by `PixelArt.tsx`. No image assets, ever.
- **Construction:** compose scenes by stamping small named sprites onto a blank canvas (`stamp`/`compose` in [scenes.ts](scenes.ts)); generate atmosphere (stars, dust, water, dunes) procedurally with the deterministic per-cell hash so patterns are stable across renders. Cell size for fields: `FIELD_PIXEL` (8px).
- **Opacity is centralized** in the `BACKDROP_OPACITY` ladder in [config.ts](config.ts) — scenes/fields never invent their own values. Dense screens (tables, ledgers) take the quietest rungs.
- **Mounting standard** (also config.ts): art extends to the very top of the screen. Fixed scenes and viewport fields mount as the first child inside the screen's SafeAreaView; scroll-length fields mount inside the ScrollView with the ScreenHeader inside the ScrollView too.
- **Static, no animation** (v1 decision — motion may come later).
- **Budget:** keep a full field under ~2,500 rects on a typical phone; thin the center, fade the dust, prefer fewer better pixels.
- **Workflow:** preview every scene as ASCII in the terminal before shipping (transpile the scene module with the TypeScript API and print the grid — see the repo's commit history for the one-liner pattern). If the ASCII doesn't read, the screen won't either.

## Litmus test for any new scene

1. Can you name the *story* in one sentence ("risk deepens as you scroll")?
2. Is there exactly one glitz element and one menace element doing real work?
3. Squint at the ASCII render — is the silhouette readable in 2 seconds?
4. Does the central column stay clean enough to read a table over?
5. At the assigned opacity rung, is it discoverable rather than noticeable?

If any answer is no, simplify and re-render.
