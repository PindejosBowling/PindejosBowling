import { useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Full-viewport western bounty board for the Bounties screen: the whole page
// is the board — a dark-wood frame around the viewport, dashed plank seams
// and the occasional knot for grain. The TOP THIRD stays bare planks on
// purpose: the house bounty card renders there and gets the conspicuous,
// uncluttered backdrop it deserves. The pinned details live in the lower
// two-thirds: a big wanted poster (gold sheriff star), a smaller poster whose
// faded face still has red eyes, and an empty nail with a torn scrap — that
// one's already been collected.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it). Sized from useWindowDimensions — synchronous on
// the first render, so the art commits in the same frame as the screen.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.field

// Details stay below this fraction of the viewport.
const DETAIL_TOP = 0.38

const POSTER_LG: Sprite = [
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

// The face is long gone; the eyes aren't.
const POSTER_SM: Sprite = [
  'pppppppp',
  'p......p',
  'p.e..e.p',
  'p......p',
  'p.tttt.p',
  'p.tt...p',
  'p......p',
  'pppppppp',
]

// An empty nail and the corner that tore off — somebody already collected.
const EMPTY_NAIL: Sprite = [
  '.o.',
  'pp.',
  'p..',
]

// Deterministic per-cell hash so the grain pattern is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

function buildBoard(cols: number, rowCount: number): string[] {
  const rows = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))

  // The board frame: a single-cell wood trim with a nail in each corner.
  for (let y = 0; y < rowCount; y++) {
    rows[y][0] = 'w'
    rows[y][cols - 1] = 'w'
  }
  for (let x = 0; x < cols; x++) {
    rows[0][x] = 'w'
    rows[rowCount - 1][x] = 'w'
  }
  rows[1][1] = 'o'
  rows[1][cols - 2] = 'o'
  rows[rowCount - 2][1] = 'o'
  rows[rowCount - 2][cols - 2] = 'o'

  // Plank seams every seventh row, dashed by hash, plus the rare knot.
  for (let y = 5; y < rowCount - 2; y += 7) {
    for (let x = 1; x < cols - 1; x++) {
      if (hash(x, y) % 100 < 55) rows[y][x] = 'w'
    }
  }
  for (let y = 2; y < rowCount - 2; y++) {
    for (let x = 2; x < cols - 2; x++) {
      if (rows[y][x] === '.' && hash(x, y) % 1000 < 4) rows[y][x] = 'k'
    }
  }

  // Pinned details — lower two-thirds only; the top third stays bare planks
  // so the house bounty card displays unchallenged. Paper occludes the board,
  // so clear the grain behind each poster before stamping it.
  const pin = (sprite: Sprite, ox: number, oy: number) => {
    sprite.forEach((row, dy) =>
      Array.from(row).forEach((_, dx) => {
        const x = ox + dx
        const y = oy + dy
        if (y >= 0 && y < rowCount && x >= 0 && x < cols) rows[y][x] = '.'
      }),
    )
    stamp(rows, sprite, ox, oy)
  }
  const detailTop = Math.floor(rowCount * DETAIL_TOP)
  pin(POSTER_LG, 3, detailTop + 3)
  stamp(rows, ['o'], 8, detailTop + 2) // its nail
  pin(POSTER_SM, cols - 11, detailTop + 14)
  stamp(rows, ['o'], cols - 8, detailTop + 13) // its nail
  pin(EMPTY_NAIL, cols - 7, detailTop + 1)

  return rows.map(r => r.join(''))
}

const PALETTE = {
  w: colors.pixelArt.wood, // frame + plank seams
  k: colors.muted2, // knots in the grain
  p: colors.pixelArt.sand, // poster paper
  t: colors.muted, // unreadable poster text
  g: colors.gold, // the sheriff star
  o: colors.text, // nails
  e: colors.danger, // the eyes that stayed
}

export default function BountyBoardBackdrop() {
  const { width, height } = useWindowDimensions()
  const cols = Math.ceil(width / PIXEL)
  const rowCount = Math.ceil(height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 30) return null
    return { rows: buildBoard(cols, rowCount), palette: PALETTE }
  }, [cols, rowCount])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {grid && (
        <View style={styles.board}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  board: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
