import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp, rekey } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport town square for Market Moves: the wire's come in and the
// news is BIG — the square has gone off like a jackpot. A row of false-front
// storefronts runs along the bottom, dark except for the telegraph office,
// every window lit under a zigzag marquee. Telegraph lines swoop in from
// both screen edges to the office mast, sparking gold down their whole
// length; fireworks burst over the rooftops; confetti falls through the
// entire sky (thinned over the central column so the feed cards read clean).
// The crowd of pin-folk at the door is the liveliest thing in the app —
// mixed colors, half of them with their arms up, a few caught mid-jump,
// hats flung overhead — while a crier on a crate reads the news out. A bird
// keeps its seat on the wire. Red eyes watch from a dark upstairs window
// next door: someone always bet the other way.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it); it measures itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.field

// A townsperson — a bare pin, no hat tonight. Palette key is rebound per
// figure so the crowd comes out in mixed colors.
const TOWNSFOLK: Sprite = [
  '.p.',
  '.p.',
  'ppp',
  'ppp',
]

// The same pin with both arms thrown up.
const CHEERING: Sprite = [
  'p.p',
  '.p.',
  'ppp',
  'ppp',
]

// A shorter pin pushed up to the front row.
const KID: Sprite = [
  '.p.',
  'ppp',
  'ppp',
]

// A hat, flung.
const HAT: Sprite = [
  '.m.',
  'mmm',
]

// A firework burst — eight dotted rays around a hot center.
const BURST: Sprite = [
  '.g...g...g.',
  '...........',
  '...g.g.g...',
  '...........',
  '.g.g.g.g.g.',
  '...........',
  '...g.g.g...',
  '...........',
  '.g...g...g.',
]

// The crier's crate.
const CRATE: Sprite = [
  'ccc',
  'ccc',
]

const BIRD: Sprite = [
  'mm.',
  '.mm',
]

const EYES: Sprite = ['e.e']

// How deep the open street runs in front of the storefronts — the stage the
// crowd stands on.
const STREET_DEPTH = 5

// Deterministic per-cell hash so the scene is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

// Crowd tints cycle through the soft pixelArt palette.
const CROWD_KEYS = ['p', 'r', 't'] as const

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  const floor = rowCount - 3

  // Confetti falling through the whole sky — gold, lime, white, and the soft
  // crowd tints — denser than any starfield, thinned over the central column.
  const CONFETTI = ['g', 'a', 's', 'p', 'r', 't']
  for (let x = 0; x < cols; x++) {
    const central = x > cols * 0.3 && x < cols * 0.7
    for (let y = 0; y < floor - 4; y++) {
      if (hash(x, y) % 1000 < (central ? 6 : 20)) {
        canvas[y][x] = CONFETTI[hash(x, y) % CONFETTI.length]
      }
    }
  }

  // Storefront row: false-fronts of varying height separated by one-column
  // alleys, dark except the odd upstairs lamp, standing behind an open
  // street strip so the crowd reads in front of them. The telegraph office —
  // taller, every window lit, mast on the roof — lands just right of center.
  const base = floor - STREET_DEPTH
  const officeX = Math.floor(cols * 0.55)
  const officeW = 13
  const officeH = 13
  let doorX = officeX + Math.floor(officeW / 2)
  let neighbor: { x: number; w: number; h: number } | null = null
  let last: { x: number; w: number; h: number } | null = null
  let x = 0
  while (x < cols) {
    const isOffice = x + 6 >= officeX && x <= officeX
    const w = isOffice ? officeW : 6 + (hash(x, 7) % 5)
    const h = isOffice ? officeH : 7 + (hash(x, 11) % 4)
    if (isOffice) {
      doorX = x + Math.floor(w / 2)
      neighbor = last
    }
    for (let bx = x; bx < Math.min(x + w, cols); bx++) {
      for (let y = base - h; y < base; y++) canvas[y][bx] = 'k'
    }
    // Windows: a sparse grid, all lit in the office, rare elsewhere.
    for (let wy = base - h + 2; wy < base - 2; wy += 2) {
      for (let wx = x + 2; wx < Math.min(x + w - 1, cols - 1); wx += 3) {
        if (isOffice || hash(wx, wy) % 100 < 12) canvas[wy][wx] = 'y'
      }
    }
    if (isOffice) {
      // The doorway, its lamp, the zigzag marquee on the false front, and
      // the mast the wires run to.
      canvas[base - 1][doorX] = '.'
      canvas[base - 2][doorX] = '.'
      canvas[base - 1][doorX + 1] = '.'
      canvas[base - 2][doorX + 1] = '.'
      canvas[base - 3][doorX] = 'a'
      for (let mx = x + 1; mx < Math.min(x + w - 1, cols - 1); mx++) {
        canvas[base - h + (mx % 2)][mx] = 'a'
      }
      for (let my = base - h - 4; my < base - h; my++) canvas[my][doorX] = 'k'
    } else {
      last = { x, w, h }
    }
    x += w + 1
  }

  // Telegraph lines swooping in from both screen edges to the mast — the
  // news arriving — with gold sparks riding them and a bird along for it.
  const mastTop = base - officeH - 4
  const wireTo = (fromX: number, fromY: number) => {
    const span = doorX - fromX
    for (let step = 0; Math.abs(step) <= Math.abs(span); step += Math.sign(span)) {
      const t = Math.abs(span) === 0 ? 1 : Math.abs(step) / Math.abs(span)
      const sag = Math.round(2 * 4 * t * (1 - t) * (1 - t))
      const wy = Math.round(fromY + (mastTop - fromY) * t) + sag
      const wx = fromX + step
      if (canvas[wy]?.[wx] === '.') canvas[wy][wx] = 'w'
      if (hash(wx, 3) % 100 < 18 && canvas[wy]?.[wx] === 'w') canvas[wy][wx] = 'g'
    }
  }
  wireTo(0, mastTop - 9)
  wireTo(cols - 1, mastTop - 6)
  // The bird sits ON the left wire: sample its column for the wire row.
  const birdX = Math.floor(doorX / 2)
  const wireRow = canvas.findIndex(row => row[birdX] === 'w' || row[birdX] === 'g')
  if (wireRow > 1) stamp(canvas, BIRD, birdX - 1, wireRow - 2)

  // Fireworks — one gold, one lime, one white, staggered down the sky so it
  // pops at every scroll position, all clear of the central column.
  stamp(canvas, BURST, Math.floor(cols * 0.16), Math.floor(rowCount * 0.1))
  stamp(canvas, rekey(BURST, { g: 'a' }), Math.floor(cols * 0.72), Math.floor(rowCount * 0.22))
  stamp(canvas, rekey(BURST, { g: 's' }), Math.floor(cols * 0.05), Math.floor(rowCount * 0.38))

  // The crowd at the door — denser near it, straggling at the ends; mixed
  // colors (neighbors never match), the short ones pushed to the front, half
  // of them cheering with their arms up, a few caught mid-jump.
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue // leave the doorway sightline clear
    const fx = doorX - 1 + i * 3 + (hash(i + 50, 13) % 2)
    if (fx < 1 || fx > cols - 4) continue
    if (Math.abs(i) > 5 && hash(i + 50, 17) % 100 < 40) continue // stragglers
    const short = hash(i + 50, 19) % 100 < 30
    const cheer = hash(i + 50, 29) % 100 < 55
    const jump = !short && hash(i + 50, 31) % 100 < 25 ? 1 : 0
    const key = CROWD_KEYS[((i % 3) + 3) % 3]
    const figure = short ? KID : cheer ? CHEERING : TOWNSFOLK
    stamp(canvas, rekey(figure, { p: key }), fx, floor - (short ? 3 : 4) - jump)
  }

  // Hats in the air above the cheering — kept off the office's lit front so
  // they read against the dark neighbors.
  stamp(canvas, HAT, doorX - 8, floor - 9)
  stamp(canvas, HAT, doorX + 8, floor - 11)
  stamp(canvas, HAT, doorX + 11, floor - 8)

  // The crier, up on a crate at the crowd's edge, paper in hand.
  const crierX = doorX - 10
  stamp(canvas, CRATE, crierX - 1, floor - 2)
  stamp(canvas, rekey(TOWNSFOLK, { p: 'n' }), crierX - 1, floor - 6)
  canvas[floor - 6][crierX + 2] = 'o'

  // Red eyes in a dark upstairs window next door — not everyone came down.
  // One row below the window line, so no lit window crowds them.
  if (neighbor) {
    stamp(canvas, EYES, neighbor.x + Math.floor(neighbor.w / 2) - 1, base - neighbor.h + 3)
  }

  // The street: a packed-dirt line with scuffed ground below it.
  for (let gx = 0; gx < cols; gx++) {
    canvas[floor][gx] = 'd'
    for (let y = floor + 1; y < rowCount; y++) {
      if (hash(gx, y) % 100 < 8) canvas[y][gx] = 'd'
    }
  }

  return canvas.map(r => r.join(''))
}

const PALETTE = {
  k: colors.muted2, // storefronts + mast
  y: colors.gold, // lit windows
  a: colors.accent, // the lamp over the office door
  g: colors.gold, // sparks on the wire
  w: colors.muted, // telegraph lines
  m: colors.muted, // the bird
  s: colors.text, // stars
  o: colors.text, // the crier's paper
  p: colors.pixelArt.purple, // townsfolk
  r: colors.pixelArt.rose, // townsfolk
  t: colors.pixelArt.teal, // townsfolk
  n: colors.pixelArt.sand, // the crier
  c: colors.pixelArt.wood, // the crate
  d: colors.pixelArt.sand, // the street
  e: colors.danger, // the alley
}

export default function MarketMovesTownBackdrop() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const cols = Math.ceil(size.width / PIXEL)
  const rowCount = Math.ceil(size.height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 30) return null
    return { rows: buildScene(cols, rowCount), palette: PALETTE }
  }, [cols, rowCount])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize(e.nativeEvent.layout)}
    >
      {grid && (
        <View style={styles.town}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  town: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
