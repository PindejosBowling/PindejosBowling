import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport desert-noir field for the Pinsino landing — minimal take on
// "glitzy but dangerous": a sparse starfield and the moon, a single neon
// diamond hanging in the night, one dune ridge with a lone saguaro, and a
// pair of red eyes glowing in the dark at the bottom.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it); it measures itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.field

const MOON: Sprite = [
  '..mmmm..',
  '.mmmmmm.',
  'mmkmmmmm',
  'mmmmmmkm',
  'mmmmkmmm',
  'mkmmmmmm',
  '.mmmmmm.',
  '..mmmm..',
]

// A small neon diamond with two gold glints — the lone piece of glitz.
const DIAMOND: Sprite = [
  '..l...g',
  '.lll...',
  'lllll..',
  '.lll...',
  'g.l....',
]

const CACTUS: Sprite = [
  '...cc..',
  '...cc..',
  '...cc..',
  'c..cc..',
  'c..cc.c',
  'c..cc.c',
  'ccccc.c',
  '...cc.c',
  '...cccc',
  '...cc..',
  '...cc..',
]

const EYES: Sprite = ['e.e']

// Deterministic per-cell hash so the speckle pattern is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  const ridgeBase = Math.floor(rowCount * 0.78)

  for (let x = 0; x < cols; x++) {
    // Night sky: a thin scatter of faint stars, the odd gold one.
    for (let y = 0; y < ridgeBase - 4; y++) {
      const h = hash(x, y) % 1000
      if (h < 10) canvas[y][x] = 'w'
      else if (h < 14) canvas[y][x] = 'g'
    }
    // One dune ridge rolling across the lower field, barely filled below.
    const yRidge = ridgeBase + Math.round(2 * Math.sin(x / 9 + 2))
    if (yRidge < rowCount) canvas[yRidge][x] = 'n'
    for (let y = yRidge + 1; y < rowCount; y++) {
      if (hash(x, y) % 100 < 5) canvas[y][x] = 'n'
    }
  }

  stamp(canvas, MOON, cols - 12, 2)
  stamp(canvas, DIAMOND, 5, Math.floor(rowCount * 0.16))
  stamp(canvas, CACTUS, 3, ridgeBase - 9) // lone saguaro rooted on the ridge
  stamp(canvas, EYES, cols - 8, Math.floor(rowCount * 0.92)) // something watching
  return canvas.map(r => r.join(''))
}

const PALETTE = {
  w: colors.text, // stars
  g: colors.gold, // gold stars, diamond glints
  l: colors.accent, // neon diamond
  m: colors.pixelArt.sand, // moon
  k: colors.muted2, // moon craters
  c: colors.pixelArt.teal, // saguaro
  n: colors.pixelArt.sand, // dune ridge
  e: colors.danger, // the eyes
}

export default function PinsinoNoirBackdrop() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const cols = Math.ceil(size.width / PIXEL)
  const rowCount = Math.ceil(size.height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 20) return null
    return { rows: buildScene(cols, rowCount), palette: PALETTE }
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
