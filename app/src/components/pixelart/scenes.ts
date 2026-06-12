import { colors } from '../../theme'
import { PixelGrid } from './PixelArt'

// Scenes are composed from small sprites stamped onto a '.'-filled canvas,
// rather than hand-maintained full-width ASCII blocks. Later placements draw
// over earlier ones.

type Sprite = string[]

function compose(
  cols: number,
  rowCount: number,
  placements: { sprite: Sprite; x: number; y: number }[],
): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  for (const { sprite, x, y } of placements) {
    sprite.forEach((row, dy) => {
      Array.from(row).forEach((ch, dx) => {
        const cx = x + dx
        const cy = y + dy
        if (ch !== '.' && cy >= 0 && cy < rowCount && cx >= 0 && cx < cols) canvas[cy][cx] = ch
      })
    })
  }
  return canvas.map(r => r.join(''))
}

// ---------------------------------------------------------------------------
// Sprites (palette keys are resolved per scene)
// ---------------------------------------------------------------------------

const PIN: Sprite = [
  '.ww.',
  '.ww.',
  '.rr.',
  '.ww.',
  'wwww',
  'wwww',
  'wwww',
  'wwww',
  '.ww.',
]

const BALL: Sprite = [
  '.bbbb.',
  'bbbbbb',
  'bdbdbb',
  'bbbbbb',
  '.bbbb.',
]

const SPARKLE: Sprite = [
  '.g.',
  'ggg',
  '.g.',
]

const STAR: Sprite = ['g']

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

// Pinsino landing: a ball rolling toward a rack of pins under a starry sky.
const pinsino: SceneDef = {
  anchor: 'bottom',
  opacity: 0.12,
  grid: {
    rows: compose(48, 14, [
      { sprite: ['n'.repeat(48)], x: 0, y: 13 },
      { sprite: BALL, x: 3, y: 8 },
      { sprite: PIN, x: 14, y: 4 },
      { sprite: PIN, x: 20, y: 4 },
      { sprite: PIN, x: 26, y: 4 },
      { sprite: PIN, x: 32, y: 4 },
      { sprite: PIN, x: 38, y: 4 },
      { sprite: SPARKLE, x: 5, y: 1 },
      { sprite: STAR, x: 11, y: 3 },
      { sprite: STAR, x: 22, y: 0 },
      { sprite: STAR, x: 30, y: 2 },
      { sprite: STAR, x: 43, y: 1 },
      { sprite: STAR, x: 45, y: 4 },
    ]),
    palette: {
      w: colors.text,
      r: colors.pixelArt.rose,
      b: colors.pixelArt.purple,
      d: colors.bg,
      g: colors.gold,
      n: colors.pixelArt.teal,
    },
  },
}

export const SCENES = {
  pinsino,
} satisfies Record<string, SceneDef>

export type SceneName = keyof typeof SCENES
