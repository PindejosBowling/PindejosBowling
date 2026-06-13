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
export function rekey(sprite: Sprite, map: Record<string, string>): Sprite {
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

// Office tower with lit windows on a sparse grid.
function building(w: number, h: number): Sprite {
  return Array.from({ length: h }, (_, dy) =>
    Array.from({ length: w }, (_, dx) =>
      dy > 0 && dx % 3 === 1 && dy % 2 === 1 ? 'y' : 'k',
    ).join(''),
  )
}

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

// Sportsbook uses SportsbookPokerTableBackdrop (a scroll-length nine-seat
// poker-table border) instead of a fixed scene.

// PvP uses PvPShootoutBackdrop (a full-viewport midnight-shootout field with
// a bezel-to-ground sky) instead of a fixed scene.

// Bounties uses BountyBoardBackdrop (a full-viewport wooden notice board with
// pinned posters in the lower two-thirds) instead of a fixed scene.

// Loan Shark uses LoanSharkDepthBackdrop (a scrolling depth field) instead of
// a fixed backdrop scene — the art length must track the scroll content.

// Auction House uses AuctionBankBackdrop (a full-viewport western bank
// interior — sealed vault, manned teller cage) instead of a fixed scene.

export const SCENES = {
  marketmoves,
} satisfies Record<string, SceneDef>

export type SceneName = keyof typeof SCENES
