import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'

// Scrolling side-border art for the Loan Shark screen: a depth gradient that
// runs the full length of the scrollable content. The top is a sunny beach;
// the water gets darker and more threatening the farther down (= the riskier
// the loan products in that area) you scroll, ending in an abyss with eyes.
//
// Mount as the first child INSIDE the ScrollView (not the SafeAreaView) so the
// strips scroll with the content. The component measures the content height
// via onLayout and regenerates the strips to match, so it works for both the
// product list and the active-loan layouts.

const COLS = 3
const PIXEL = 6
const OPACITY = 0.22

// Small fin that fits the 3-column strip.
const FIN: { dx: number; dy: number; ch: string }[] = [
  { dx: 1, dy: 0, ch: 's' },
  { dx: 0, dy: 1, ch: 's' },
  { dx: 1, dy: 1, ch: 's' },
  { dx: 2, dy: 1, ch: 's' },
]

// Deterministic per-cell hash so the speckle pattern is stable across renders.
function hash(x: number, y: number, seed: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663) ^ (seed * 83492791)) >>> 0
}

function buildStrip(
  rowCount: number,
  seed: number,
  finFracs: number[],
  eyeFracs: number[],
): string[] {
  const rows = Array.from({ length: rowCount }, () => Array<string>(COLS).fill('.'))

  for (let y = 0; y < rowCount; y++) {
    const f = y / rowCount
    for (let x = 0; x < COLS; x++) {
      const h = hash(x, y, seed) % 100
      if (f < 0.04) {
        rows[y][x] = 'n' // beach
      } else if (f < 0.07) {
        if (h < 70) rows[y][x] = h % 2 ? 'n' : 'v' // surf line
      } else if (f < 0.3) {
        if (h < 20) rows[y][x] = 'v' // sunny shallows
      } else if (f < 0.55) {
        if (h < 32) rows[y][x] = h % 3 ? 'v' : 'u' // mid-water, cooling off
      } else if (f < 0.8) {
        if (h < 3) rows[y][x] = 'o' // stray bubbles
        else if (h < 46) rows[y][x] = h % 3 ? 'u' : 'm' // deep water
      } else {
        if (h < 2) rows[y][x] = 'e' // glints in the dark
        else if (h < 72) rows[y][x] = h % 4 ? 'a' : 'm' // the abyss
      }
    }
  }

  for (const frac of finFracs) {
    const top = Math.floor(frac * rowCount)
    for (const { dx, dy, ch } of FIN) {
      if (top + dy < rowCount) rows[top + dy][dx] = ch
    }
  }
  for (const frac of eyeFracs) {
    const y = Math.floor(frac * rowCount)
    if (y < rowCount) {
      rows[y][0] = 'e'
      rows[y][2] = 'e'
    }
  }

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

export default function LoanSharkDepthBorders() {
  const [height, setHeight] = useState(0)
  const rowCount = Math.ceil(height / PIXEL)

  const strips = useMemo<{ left: PixelGrid; right: PixelGrid } | null>(() => {
    if (rowCount < 20) return null
    return {
      left: { rows: buildStrip(rowCount, 1, [0.42, 0.72], [0.92]), palette: PALETTE },
      right: { rows: buildStrip(rowCount, 2, [0.52, 0.64], [0.96]), palette: PALETTE },
    }
  }, [rowCount])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setHeight(e.nativeEvent.layout.height)}
    >
      {strips && (
        <>
          <View style={[styles.strip, styles.left]}>
            <PixelArt grid={strips.left} pixelSize={PIXEL} />
          </View>
          <View style={[styles.strip, styles.right]}>
            <PixelArt grid={strips.right} pixelSize={PIXEL} />
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, opacity: OPACITY },
  left: { left: 0 },
  right: { right: 0 },
})
