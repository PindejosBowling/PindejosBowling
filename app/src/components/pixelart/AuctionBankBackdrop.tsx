import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport western bank interior for the Auction House: after hours at
// the territorial bank — the vault is sealed, but someone's still at the
// teller window. A big round vault door rests on the floor bottom-left; a
// teller cage fills the bottom-right with one open window in the bars — red
// eyes in the window, a small stack of gold coins on the counter beneath
// them. Two pendant lamps hang from the bezel; dust drifts in their light,
// thinned over the central column so the lot cards read clean.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it); it measures itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.field

const VAULT_DIAMETER = 15
const CAGE_WIDTH = 16
const CAGE_BAR_HEIGHT = 8

// The teller's eyes, and the change they never push across.
const EYES: Sprite = ['e.e']
const COINS: Sprite = [
  '.g.',
  'ggg',
]

// A pendant lamp: chain from the bezel, shade, one gold bulb.
const LAMP: Sprite = [
  '.b.',
  '.b.',
  '.b.',
  '.b.',
  'bbb',
  '.g.',
]

// Deterministic per-cell hash so the dust pattern is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

// The round vault door: rim circle, steel face, four-spoke wheel, white hub.
function vaultDoor(): Sprite {
  const d = VAULT_DIAMETER
  const c = (d - 1) / 2
  const r = c + 0.3
  const rows = Array.from({ length: d }, () => Array<string>(d).fill('.'))
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dist = Math.sqrt((x - c) ** 2 + (y - c) ** 2)
      if (dist <= r) rows[y][x] = dist > r - 1.2 ? 'd' : 'v'
    }
  }
  // Wheel: cross spokes length 5, white hub.
  for (let i = -5; i <= 5; i++) {
    rows[c][c + i] = 'd'
    rows[c + i][c] = 'd'
  }
  rows[c][c] = 'o'
  return rows.map(r2 => r2.join(''))
}

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  const floor = rowCount - 3

  // Dust drifting in the lamplight — sparse, thinned over the central column.
  for (let x = 0; x < cols; x++) {
    const central = x > cols * 0.3 && x < cols * 0.7
    for (let y = 0; y < floor; y++) {
      if (hash(x, y) % 1000 < (central ? 2 : 6)) canvas[y][x] = 'u'
    }
  }

  // Pendant lamps hanging from the bezel.
  stamp(canvas, LAMP, Math.floor(cols * 0.15) - 1, 0)
  stamp(canvas, LAMP, Math.floor(cols * 0.85) - 1, 0)

  // Floorboards: a full-width line with specks of grain below it.
  for (let x = 0; x < cols; x++) {
    canvas[floor][x] = 'c'
    for (let y = floor + 1; y < rowCount; y++) {
      if (hash(x, y) % 100 < 8) canvas[y][x] = 'c'
    }
  }

  // The vault, sealed, resting on the floor bottom-left.
  stamp(canvas, vaultDoor(), 2, floor - VAULT_DIAMETER)

  // The teller cage bottom-right: counter, bars, top rail — and one open
  // window in the bars where the eyes and the coins are.
  const cageLeft = cols - CAGE_WIDTH
  const counterY = floor - CAGE_BAR_HEIGHT
  for (let x = cageLeft; x < cols; x++) {
    canvas[counterY][x] = 'c'
    canvas[counterY - CAGE_BAR_HEIGHT - 1][x] = 'b'
  }
  // The counter's end panel, so it stands on the floor instead of floating.
  for (let y = counterY + 1; y < floor; y++) canvas[y][cageLeft] = 'c'
  for (let off = 1; off < CAGE_WIDTH; off += 2) {
    if (off === 7 || off === 9) continue // the teller window
    for (let y = counterY - CAGE_BAR_HEIGHT; y < counterY; y++) {
      canvas[y][cageLeft + off] = 'b'
    }
  }
  stamp(canvas, EYES, cageLeft + 7, counterY - 5)
  stamp(canvas, COINS, cageLeft + 7, counterY - 2)

  return canvas.map(r => r.join(''))
}

const PALETTE = {
  d: colors.muted2, // vault rim + wheel
  v: colors.surface3, // vault face
  o: colors.text, // wheel hub
  b: colors.muted, // cage bars + rail, lamp chain + shade
  c: colors.pixelArt.wood, // counter, floorboards
  g: colors.gold, // lamp bulbs, the coins
  u: colors.pixelArt.sand, // dust in the lamplight
  e: colors.danger, // the teller's eyes
}

export default function AuctionBankBackdrop() {
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
        <View style={styles.bank}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bank: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
