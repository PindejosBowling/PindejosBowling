import { useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp, rekey } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport hero field for the PvP screen: a high-noon duel. The whole
// scene is dropped to the bottom of the viewport — two bowling-pin bandits
// drawn down across a dusty street, a saguaro, a tumbleweed, and a dark
// doorway with red eyes watching from the shade — under a wide, deliberately
// thin sky that carries only the blazing overhead sun and a pair of circling
// buzzards. The two pins sit at the far left and right so the central column
// stays clean for the cards.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it). Sized from useWindowDimensions — synchronous on
// the first render, so the art commits in the same frame as the screen.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.sceneHero

// A bowling pin done up as a bandit, facing RIGHT. Unmistakably a pin — small
// rounded head, the two classic neck stripes (doubling as a kerchief), a belly
// that bulges wide and tapers to a narrow base — under a cowboy hat, with the
// gun arm reaching toward the opponent and a gold muzzle glint at the barrel.
// Mirror it for the duelist on the other side. 'w' is the body (rekeyed per
// side); 'd' the bone-white stripes; 'h' the hat; 'g' the muzzle glint.
const GUNSLINGER: Sprite = [
  '...hhh....',
  '.hhhhhhh..',
  '...www....',
  '...ddd....',
  '...www....',
  '...ddd....',
  '..wwwww...',
  '..wwwwwwwg',
  '.wwwwwww..',
  '.wwwwwww..',
  '.wwwwwww..',
  '.wwwwwww..',
  '.wwwwwww..',
  '.wwwwwww..',
  '..wwwww...',
  '..wwwww...',
  '...www....',
  '...www....',
]

function mirror(sprite: Sprite): Sprite {
  return sprite.map(row => Array.from(row).reverse().join(''))
}

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

// A distant buzzard — wings and a body, circling above the duel.
const BUZZARD: Sprite = [
  'm..m',
  '.mm.',
]

// A dark doorway at the edge of the street — and someone in the shade,
// watching the duel through it.
const DARK_DOOR: Sprite = [
  'kkkkk',
  'k...k',
  'ke.ek',
  'k...k',
  'k...k',
]

// Deterministic per-cell hash so dust + heat haze are stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

// The blazing overhead sun: a filled gold core with eight short rays. Stamped
// rather than drawn as ASCII so the disc stays round at any size.
function stampSun(canvas: string[][], cx: number, cy: number) {
  const rowCount = canvas.length
  const cols = canvas[0].length
  const R = 3
  const set = (x: number, y: number) => {
    if (y >= 0 && y < rowCount && x >= 0 && x < cols) canvas[y][x] = 'g'
  }
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      if (Math.sqrt(x * x + y * y) <= R) set(cx + x, cy + y)
    }
  }
  const rays = [[0, -1], [0, 1], [-1, 0], [1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (const [dx, dy] of rays) {
    for (let t = R + 2; t <= R + 3; t++) set(cx + dx * t, cy + dy * t)
  }
}

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))

  // The street is dropped near the foot of the screen: the duel fills the
  // bottom, only a thin strip of dust runs below it, and the whole sky above
  // stays wide and bare on purpose.
  const ground = Math.floor(rowCount * 0.87)
  const pinH = GUNSLINGER.length
  const duelTop = ground - pinH

  // Thin sky: the overhead sun, high and centered (it's noon), and two
  // buzzards circling off to the sides down in the open air — nothing else
  // competes up here.
  stampSun(canvas, Math.floor(cols / 2), Math.floor(rowCount * 0.1))
  stamp(canvas, BUZZARD, Math.floor(cols * 0.3), Math.floor(rowCount * 0.34))
  stamp(canvas, BUZZARD, Math.floor(cols * 0.64), Math.floor(rowCount * 0.46))

  // Horizon dressing, kept to the edges: a saguaro on the left, a dark
  // doorway with watching eyes at the right.
  stamp(canvas, SAGUARO, 1, ground - SAGUARO.length)
  stamp(canvas, DARK_DOOR, cols - DARK_DOOR[0].length - 1, ground - DARK_DOOR.length)

  // The two duelists at the far left and right, drawn down on each other —
  // gun arms (and their gold glints) facing toward the center.
  const leftPin = Math.floor(cols * 0.12)
  const rightPin = cols - leftPin - GUNSLINGER[0].length
  stamp(canvas, rekey(GUNSLINGER, { w: 'b' }), leftPin, duelTop)
  stamp(canvas, rekey(mirror(GUNSLINGER), { w: 'r' }), rightPin, duelTop)

  // A tumbleweed loose on the street between them, just off-center.
  stamp(canvas, TUMBLEWEED, Math.floor(cols * 0.44), ground - TUMBLEWEED.length)

  // Heat haze shimmering just above the street — sparse dashes, kept out of
  // the central column so it never muddies the cards.
  for (let x = 0; x < cols; x++) {
    const central = x > cols * 0.35 && x < cols * 0.65
    for (const y of [ground - 2, ground - 3]) {
      if (!central && canvas[y][x] === '.' && hash(x, y) % 100 < 12) canvas[y][x] = 'f'
    }
  }

  // The street line and the dust kicked up below it.
  for (let x = 0; x < cols; x++) {
    canvas[ground][x] = 'f'
    for (let y = ground + 1; y < rowCount; y++) {
      if (hash(x, y) % 100 < 8) canvas[y][x] = 'f'
    }
  }

  return canvas.map(r => r.join(''))
}

const PALETTE = {
  g: colors.gold, // the sun, the gun glints
  b: colors.pixelArt.purple, // left duelist
  r: colors.pixelArt.rose, // right duelist
  d: colors.text, // the bone-white pin stripes
  h: colors.muted2, // hats
  k: colors.surface3, // the doorway frame
  n: colors.pixelArt.teal, // saguaro
  u: colors.pixelArt.sand, // tumbleweed
  f: colors.pixelArt.sand, // street, dust, heat haze
  m: colors.muted, // buzzards
  e: colors.danger, // the eyes in the doorway
}

export default function PvPShootoutBackdrop() {
  const { width, height } = useWindowDimensions()
  const cols = Math.ceil(width / PIXEL)
  const rowCount = Math.ceil(height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 30) return null
    return { rows: buildScene(cols, rowCount), palette: PALETTE }
  }, [cols, rowCount])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {grid && (
        <View style={styles.field}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
