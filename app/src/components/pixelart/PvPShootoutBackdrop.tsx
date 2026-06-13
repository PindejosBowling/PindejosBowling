import { useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp, rekey } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport hero field for the PvP screen: a Texas shootout at midnight.
// The night sky runs from the physical bezel all the way down to the duel —
// a sparse procedural starfield (thinned over the central column, generous
// negative space) with a few placed details: a shooting star, one bright
// four-point star, and two buzzards circling above the duel. The shootout
// itself — two gunslinger pins, holster glints, tumbleweed, saguaro, eyes on
// the ridge — is pinned to the bottom of the viewport.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it). Sized from useWindowDimensions — synchronous on
// the first render, so the art commits in the same frame as the screen.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.sceneHero

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

// A bright four-point star, white-hot among the single-pixel scatter.
const BRIGHT_STAR: Sprite = [
  '.s.',
  'sss',
  '.s.',
]

// Streak with a head — a wish nobody out here is making.
const SHOOTING_STAR: Sprite = [
  's...',
  '.s..',
  '..ss',
]

// A distant buzzard — wings and a body, circling above the duel.
const BUZZARD: Sprite = [
  'm..m',
  '.mm.',
]

const EYES: Sprite = ['e.e']

// Deterministic per-cell hash so the speckle pattern is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))

  // The duel band hugs the bottom: ground line with a little dust below it.
  const ground = rowCount - 4
  const duelTop = ground - 11

  // Night sky from the bezel down to the hat brims: a thin scatter of faint
  // stars (the odd gold one), dramatically thinned over the central column.
  for (let x = 0; x < cols; x++) {
    const central = x > cols * 0.3 && x < cols * 0.7
    for (let y = 0; y < duelTop - 1; y++) {
      const h = hash(x, y) % 1000
      const mult = central ? 0.35 : 1
      if (h < 7 * mult) canvas[y][x] = 's'
      else if (h < 9 * mult) canvas[y][x] = 'g'
    }
  }

  // Placed sky details — sparse on purpose; the dark is the ambience.
  stamp(canvas, SHOOTING_STAR, cols - 9, Math.floor(rowCount * 0.1))
  stamp(canvas, BRIGHT_STAR, 4, Math.floor(rowCount * 0.3))
  // Buzzards circling above the duel, waiting on the outcome.
  stamp(canvas, BUZZARD, Math.floor(cols * 0.46), duelTop - 18)
  stamp(canvas, BUZZARD, Math.floor(cols * 0.58), duelTop - 11)

  // The shootout.
  const leftPin = Math.floor(cols * 0.13)
  const rightPin = cols - leftPin - 7
  stamp(canvas, SAGUARO, 0, ground - 7)
  stamp(canvas, rekey(GUNSLINGER_PIN, { w: 'b' }), leftPin, duelTop)
  stamp(canvas, rekey(GUNSLINGER_PIN, { w: 'r' }), rightPin, duelTop)
  // Holster glints — each hand hovering on the side facing the opponent.
  stamp(canvas, ['g'], leftPin + 7, ground - 4)
  stamp(canvas, ['g'], rightPin - 1, ground - 4)
  stamp(canvas, TUMBLEWEED, Math.floor(cols / 2) - 2, ground - 4)
  stamp(canvas, EYES, cols - 4, ground - 2)

  // Street and the dust beyond it.
  for (let x = 0; x < cols; x++) {
    canvas[ground][x] = 'f'
    for (let y = ground + 1; y < rowCount; y++) {
      if (hash(x, y) % 100 < 8) canvas[y][x] = 'f'
    }
  }

  return canvas.map(r => r.join(''))
}

const PALETTE = {
  s: colors.text, // stars
  g: colors.gold, // gold stars, holster glints
  b: colors.pixelArt.purple, // left duelist
  r: colors.pixelArt.rose, // right duelist
  h: colors.muted, // hats
  m: colors.muted, // buzzards
  u: colors.pixelArt.sand, // tumbleweed
  n: colors.pixelArt.teal, // saguaro
  f: colors.pixelArt.sand, // street + dust
  e: colors.danger, // eyes on the ridge
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
