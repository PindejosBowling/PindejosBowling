import { colors } from '../../theme'
import { PixelGrid } from './PixelArt'
import { BACKDROP_OPACITY } from './config'

// Scenes are composed from small sprites stamped onto a '.'-filled canvas,
// rather than hand-maintained full-width ASCII blocks. Later placements draw
// over earlier ones.

export type Sprite = string[]

/** Stamp a sprite onto a mutable canvas, clipping at the edges. */
export function stamp(canvas: string[][], sprite: Sprite, x: number, y: number) {
  const rowCount = canvas.length
  const cols = canvas[0]?.length ?? 0
  sprite.forEach((row, dy) => {
    Array.from(row).forEach((ch, dx) => {
      const cx = x + dx
      const cy = y + dy
      if (ch !== '.' && cy >= 0 && cy < rowCount && cx >= 0 && cx < cols) canvas[cy][cx] = ch
    })
  })
}

function compose(
  cols: number,
  rowCount: number,
  placements: { sprite: Sprite; x: number; y: number }[],
): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  for (const { sprite, x, y } of placements) stamp(canvas, sprite, x, y)
  return canvas.map(r => r.join(''))
}

/** Swap palette keys so one sprite can be reused in different colors. */
function rekey(sprite: Sprite, map: Record<string, string>): Sprite {
  return sprite.map(row => Array.from(row).map(ch => map[ch] ?? ch).join(''))
}

// ---------------------------------------------------------------------------
// Sprites (palette keys are resolved per scene)
// ---------------------------------------------------------------------------

const SPARKLE: Sprite = [
  '.g.',
  'ggg',
  '.g.',
]

const STAR: Sprite = ['g']

// A bowling pin in a cowboy hat — one half of the shootout. Symmetric; which
// way it "faces" is implied by where its holster glint is stamped.
const GUNSLINGER_PIN: Sprite = [
  '..hhh..',
  'hhhhhhh',
  '..www..',
  '..www..',
  '...w...',
  '...w...',
  '..www..',
  '.wwwww.',
  '.wwwww.',
  '.wwwww.',
  '..www..',
]

const TUMBLEWEED: Sprite = [
  '.uu.',
  'u..u',
  'u..u',
  '.uu.',
]

const SAGUARO: Sprite = [
  '..n..',
  'n.n..',
  'n.n.n',
  'nnn.n',
  '..nnn',
  '..n..',
  '..n..',
]

// Office tower with lit windows on a sparse grid.
function building(w: number, h: number): Sprite {
  return Array.from({ length: h }, (_, dy) =>
    Array.from({ length: w }, (_, dx) =>
      dy > 0 && dx % 3 === 1 && dy % 2 === 1 ? 'y' : 'k',
    ).join(''),
  )
}

const SCOREBOARD: Sprite = [
  '.......f........',
  '.......f........',
  'ffffffffffffffff',
  'f..............f',
  'f.yy.yy...w.ww.f',
  'f..............f',
  'f.ww.w....yy.y.f',
  'f..............f',
  'ffffffffffffffff',
  '....f......f....',
  '....f......f....',
]

const WANTED_POSTER: Sprite = [
  'pppppppppppp',
  'p..........p',
  'p.tt.tt.tt.p',
  'p..........p',
  'p....gg....p',
  'p...gggg...p',
  'p..gggggg..p',
  'p...gggg...p',
  'p....gg....p',
  'p..........p',
  'p.tttttttt.p',
  'p..tttttt..p',
  'p..........p',
  'pppppppppppp',
]

const GAVEL_HEAD: Sprite = [
  '.hhhhhh.',
  'hhhhhhhh',
  'hhhhhhhh',
  '.hhhhhh.',
]

const GAVEL_HANDLE: Sprite = [
  'll',
  'll',
  'll',
  'll',
]

const SOUND_BLOCK: Sprite = [
  '.kkkkkkkk.',
  'kkkkkkkkkk',
]

// ---------------------------------------------------------------------------
// Scene definitions
// ---------------------------------------------------------------------------

export type SceneDef = {
  grid: PixelGrid
  /** Where the art hugs the screen. 'bottom' stretches full-bleed across the width. */
  anchor: 'bottom' | 'bottomCenter' | 'bottomRight' | 'topRight'
  /** Cell size in px. Ignored for 'bottom' scenes (derived from screen width). */
  pixelSize?: number
  opacity: number
}

// The Pinsino landing uses PinsinoNoirBackdrop (a full-viewport desert-noir
// field) instead of a fixed scene — the art must fill whatever screen it's on.

// Market Moves: a city skyline under a zigzagging ticker line.
const tickerLine: Sprite = (() => {
  const rows = Array.from({ length: 4 }, () => Array<string>(44).fill('.'))
  const path = [3, 2, 1, 0, 1, 2]
  for (let x = 0; x < 41; x++) rows[path[x % path.length]][x] = 't'
  // Arrowhead pointing up at the end of the line.
  rows[0][43] = 'a'
  rows[1][42] = 'a'
  rows[1][43] = 'a'
  rows[2][41] = 'a'
  rows[2][42] = 'a'
  rows[2][43] = 'a'
  return rows.map(r => r.join(''))
})()

const marketmoves: SceneDef = {
  anchor: 'bottom',
  opacity: BACKDROP_OPACITY.scene,
  grid: {
    rows: compose(48, 12, [
      { sprite: building(6, 6), x: 0, y: 5 },
      { sprite: building(8, 9), x: 7, y: 2 },
      { sprite: building(5, 4), x: 16, y: 7 },
      { sprite: building(7, 7), x: 22, y: 4 },
      { sprite: building(6, 5), x: 30, y: 6 },
      { sprite: building(8, 8), x: 37, y: 3 },
      { sprite: building(3, 4), x: 45, y: 7 },
      { sprite: ['n'.repeat(48)], x: 0, y: 11 },
      { sprite: tickerLine, x: 1, y: 0 },
    ]),
    palette: {
      k: colors.muted2,
      y: colors.gold,
      t: colors.accent,
      a: colors.success,
      n: colors.pixelArt.teal,
    },
  },
}

// Sportsbook: a dot-matrix scoreboard on legs. Quietest — the screen is dense.
const sportsbook: SceneDef = {
  anchor: 'bottomRight',
  pixelSize: 6,
  opacity: BACKDROP_OPACITY.sceneDense,
  grid: {
    rows: SCOREBOARD,
    palette: {
      f: colors.muted,
      y: colors.gold,
      w: colors.text,
    },
  },
}

// PvP: a Texas shootout at midnight — two gunslinger pins drawn down on each
// other across an empty desert street, tumbleweed mid-roll, eyes on the ridge.
// Tall hero scene: full-bleed, roughly the bottom half of the screen.
const nightStar = rekey(STAR, { g: 's' })

const pvpStars: { x: number; y: number }[] = [
  { x: 3, y: 3 }, { x: 10, y: 7 }, { x: 15, y: 2 }, { x: 24, y: 5 },
  { x: 33, y: 4 }, { x: 40, y: 7 }, { x: 45, y: 3 }, { x: 5, y: 14 },
  { x: 13, y: 18 }, { x: 36, y: 15 }, { x: 44, y: 20 }, { x: 2, y: 24 },
  { x: 46, y: 28 }, { x: 8, y: 29 },
]

const pvpDust: { x: number; y: number }[] = [
  { x: 4, y: 48 }, { x: 11, y: 47 }, { x: 19, y: 49 },
  { x: 27, y: 48 }, { x: 35, y: 47 }, { x: 43, y: 48 },
]

const pvp: SceneDef = {
  anchor: 'bottom',
  opacity: BACKDROP_OPACITY.sceneHero,
  grid: {
    rows: compose(48, 50, [
      // Night sky — star scatter thinned over the central column.
      ...pvpStars.map(({ x, y }) => ({ sprite: nightStar, x, y })),
      { sprite: SAGUARO, x: 0, y: 39 },
      { sprite: rekey(GUNSLINGER_PIN, { w: 'b' }), x: 6, y: 35 },
      { sprite: rekey(GUNSLINGER_PIN, { w: 'r' }), x: 35, y: 35 },
      // Holster glints — each hand hovering on the side facing the opponent.
      { sprite: ['g'], x: 13, y: 42 },
      { sprite: ['g'], x: 34, y: 42 },
      { sprite: TUMBLEWEED, x: 22, y: 42 },
      { sprite: ['e.e'], x: 44, y: 44 },
      { sprite: ['f'.repeat(48)], x: 0, y: 46 },
      ...pvpDust.map(({ x, y }) => ({ sprite: ['f'], x, y })),
    ]),
    palette: {
      s: colors.text,
      b: colors.pixelArt.purple,
      r: colors.pixelArt.rose,
      h: colors.muted,
      g: colors.gold,
      u: colors.pixelArt.sand,
      n: colors.pixelArt.teal,
      f: colors.pixelArt.sand,
      e: colors.danger,
    },
  },
}

// Bounties: a wanted poster with a sheriff-star centerpiece.
const bounty: SceneDef = {
  anchor: 'topRight',
  pixelSize: 5,
  opacity: BACKDROP_OPACITY.scene,
  grid: {
    rows: WANTED_POSTER,
    palette: {
      p: colors.pixelArt.sand,
      t: colors.muted,
      g: colors.gold,
    },
  },
}

// Loan Shark uses LoanSharkDepthBackdrop (a scrolling depth field) instead of
// a fixed backdrop scene — the art length must track the scroll content.

// Auction House: the gavel mid-strike, sparks flying off the sound block.
const auction: SceneDef = {
  anchor: 'bottomRight',
  pixelSize: 6,
  opacity: BACKDROP_OPACITY.scene,
  grid: {
    rows: compose(14, 13, [
      { sprite: GAVEL_HEAD, x: 3, y: 0 },
      { sprite: GAVEL_HANDLE, x: 6, y: 4 },
      { sprite: STAR, x: 1, y: 7 },
      { sprite: STAR, x: 12, y: 7 },
      { sprite: STAR, x: 0, y: 9 },
      { sprite: STAR, x: 13, y: 9 },
      { sprite: SOUND_BLOCK, x: 2, y: 10 },
      { sprite: ['n'.repeat(14)], x: 0, y: 12 },
    ]),
    palette: {
      h: colors.pixelArt.sand,
      l: colors.pixelArt.rose,
      g: colors.gold,
      k: colors.pixelArt.teal,
      n: colors.pixelArt.sand,
    },
  },
}

export const SCENES = {
  marketmoves,
  sportsbook,
  pvp,
  bounty,
  auction,
} satisfies Record<string, SceneDef>

export type SceneName = keyof typeof SCENES
