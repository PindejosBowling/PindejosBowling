import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-bleed scrolling depth field for the Loan Shark screen. The art runs the
// entire scrollable length and maps depth to loan risk top-to-bottom: a solid
// beach band, the surf line, then open water that gets darker and more
// threatening on the way down, ending in an abyss with eyes.
//
// The side gutters carry the densest speckle (they're always visible); behind
// the loan cards the dots go sporadic so the field reads in the gaps without
// bloating the rect count. Mount as the first child INSIDE the ScrollView —
// with the ScreenHeader also inside the ScrollView so the field reaches the
// very top of the screen (the mounting standard in ./config.ts); it measures
// itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.scrollField
const EDGE_COLS = 3 // gutter width (in cells) that keeps full speckle density
const CENTER_DENSITY = 0.08 // density multiplier behind the cards

// Small fin for the gutters.
const FIN: { dx: number; dy: number; ch: string }[] = [
  { dx: 1, dy: 0, ch: 's' },
  { dx: 0, dy: 1, ch: 's' },
  { dx: 1, dy: 1, ch: 's' },
  { dx: 2, dy: 1, ch: 's' },
]

// Deterministic per-cell hash so the speckle pattern is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

function buildField(cols: number, rowCount: number): string[] {
  const rows = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))

  for (let y = 0; y < rowCount; y++) {
    const f = y / rowCount
    for (let x = 0; x < cols; x++) {
      const h = hash(x, y) % 100
      if (f < 0.045) {
        rows[y][x] = 'n' // solid beach
        continue
      }
      if (f < 0.075) {
        if (h < 70) rows[y][x] = h % 2 ? 'n' : 'v' // surf line, full width
        continue
      }
      // Open water: full density in the side gutters, sporadic behind cards.
      const distFromEdge = Math.min(x, cols - 1 - x)
      const mult = distFromEdge < EDGE_COLS ? 1 : CENTER_DENSITY
      if (f < 0.3) {
        if (h < 13 * mult) rows[y][x] = 'v' // sunny shallows
      } else if (f < 0.55) {
        if (h < 21 * mult) rows[y][x] = h % 3 ? 'v' : 'u' // mid-water, cooling off
      } else if (f < 0.8) {
        if (h < 3 * mult) rows[y][x] = 'o' // stray bubbles
        else if (h < 31 * mult) rows[y][x] = h % 3 ? 'u' : 'm' // deep water
      } else {
        if (h < 2 * mult) rows[y][x] = 'e' // glints in the dark
        else if (h < 48 * mult) rows[y][x] = h % 4 ? 'a' : 'm' // the abyss
      }
    }
  }

  // Fins crest in the gutters; eye pairs wait at the bottom.
  const stampFin = (left: boolean, frac: number) => {
    const top = Math.floor(frac * rowCount)
    const ox = left ? 0 : cols - 3
    for (const { dx, dy, ch } of FIN) {
      if (top + dy < rowCount) rows[top + dy][ox + dx] = ch
    }
  }
  stampFin(true, 0.42)
  stampFin(false, 0.52)
  stampFin(false, 0.64)
  stampFin(true, 0.72)

  const stampEyes = (left: boolean, frac: number) => {
    const y = Math.floor(frac * rowCount)
    const ox = left ? 0 : cols - 3
    if (y < rowCount) {
      rows[y][ox] = 'e'
      rows[y][ox + 2] = 'e'
    }
  }
  stampEyes(true, 0.92)
  stampEyes(false, 0.96)

  return rows.map(r => r.join(''))
}

const PALETTE = {
  n: colors.pixelArt.sand,
  v: colors.pixelArt.teal,
  u: colors.pixelArt.purple,
  m: colors.muted2,
  a: colors.surface3,
  s: colors.muted,
  o: colors.text,
  e: colors.danger,
}

export default function LoanSharkDepthBackdrop() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const cols = Math.ceil(size.width / PIXEL)
  const rowCount = Math.ceil(size.height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 20) return null
    return { rows: buildField(cols, rowCount), palette: PALETTE }
  }, [cols, rowCount])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize(e.nativeEvent.layout)}
    >
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
