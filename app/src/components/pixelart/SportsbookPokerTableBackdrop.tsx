import { useMemo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Scroll-length poker table for the Sportsbook: the whole page is one long
// nine-seat table seen from above. A two-cell wooden rail wraps the perimeter
// (rounded corners), a felt line runs just inside it, and nine seat cushions
// sit around the rail — three across the top, two per side, two across the
// bottom — each dressed with a small trinket: fanned cards, chip stacks, a
// martini, a pair of dice, the dealer button. The betting lines play out on
// the felt; a pair of red eyes waits under the table's bottom rail.
//
// Seat positions are fractions of the measured scroll length, so the table
// re-lays itself whenever the view toggles / collapsible line groups change
// the content height (onLayout re-fires and the grid rebuilds). Mount as the
// first child INSIDE the ScrollView (with the ScreenHeader inside too — the
// mounting standard in ./config.ts).

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.scrollField

// Fractions of the scroll length where the side seats sit (two per side).
const SIDE_SEAT_FRACTIONS = [0.35, 0.65]

// Trinkets (palette: o = white, g/p/r = chips, t = felt).
const CARDS: Sprite = [
  'oo.o',
  'oooo',
  '.ooo',
]

const CHIP_STACK: Sprite = [
  'gg',
  'pp',
  'gg',
]

const CHIP_STACK_TALL: Sprite = [
  'rr',
  'gg',
  'rr',
  'gg',
]

const MARTINI: Sprite = [
  'o.o',
  '.o.',
  '.o.',
]

const DICE: Sprite = [
  'o..',
  '..o',
]

const DEALER_BUTTON: Sprite = ['o']

const EYES: Sprite = ['e.e']

function buildTable(cols: number, rowCount: number): string[] {
  const rows = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))

  // The rail: a two-cell wooden border around the entire scroll length.
  for (let y = 0; y < rowCount; y++) {
    rows[y][0] = rows[y][1] = 'w'
    rows[y][cols - 1] = rows[y][cols - 2] = 'w'
  }
  for (let x = 0; x < cols; x++) {
    rows[0][x] = rows[1][x] = 'w'
    rows[rowCount - 1][x] = rows[rowCount - 2][x] = 'w'
  }
  // Rounded corners: knock the extreme corner cells out.
  rows[0][0] = rows[0][cols - 1] = '.'
  rows[rowCount - 1][0] = rows[rowCount - 1][cols - 1] = '.'

  // The felt line just inside the rail (verticals dashed to stay in budget).
  for (let x = 2; x < cols - 2; x++) {
    rows[2][x] = 'f'
    rows[rowCount - 3][x] = 'f'
  }
  for (let y = 3; y < rowCount - 3; y++) {
    // Left dash rides one cell further out (on the rail's inner cell) so the
    // table reads one pixel wider on that side; the off cells go dark so the
    // dash rhythm mirrors the right side's gaps.
    rows[y][1] = y % 2 ? 'f' : '.'
    if (y % 2) rows[y][cols - 3] = 'f'
  }

  // A seat: a cushion segment recoloring the outer rail cells.
  const cushionH = (x: number, y: number) => {
    for (let dx = -2; dx <= 2; dx++) {
      if (x + dx >= 0 && x + dx < cols) rows[y][x + dx] = 'c'
    }
  }
  const cushionV = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      if (y + dy >= 1 && y + dy < rowCount - 1) rows[y + dy][x] = 'c'
    }
  }

  // Three seats across the top (the header zone is transparent, so the
  // trinkets read in the open space around the title).
  const topX = [0.25, 0.5, 0.75].map(f => Math.floor(cols * f))
  topX.forEach(x => cushionH(x, 0))
  stamp(rows, CARDS, topX[0] - 2, 3)
  stamp(rows, CHIP_STACK, topX[1] - 1, 3)
  stamp(rows, MARTINI, topX[2] - 1, 3)

  // Two seats per side, placed by fraction of the measured length; each
  // player keeps a chip on the rail.
  const sideY = SIDE_SEAT_FRACTIONS.map(f => Math.floor(rowCount * f))
  sideY.forEach((y, i) => {
    cushionV(0, y)
    cushionV(cols - 1, y)
    rows[y - 3][1] = i % 2 ? 'g' : 'p'
    rows[y + 3][cols - 2] = i % 2 ? 'r' : 'g'
  })

  // Two seats across the bottom: dice at one, the dealer's stack + button at
  // the other.
  const bottomX = [0.33, 0.66].map(f => Math.floor(cols * f))
  bottomX.forEach(x => cushionH(x, rowCount - 1))
  stamp(rows, DICE, bottomX[0] - 1, rowCount - 5)
  stamp(rows, CHIP_STACK_TALL, bottomX[1] - 1, rowCount - 7)
  stamp(rows, DEALER_BUTTON, bottomX[1] + 2, rowCount - 4)

  // Something under the table.
  stamp(rows, EYES, 4, rowCount - 5)

  return rows.map(r => r.join(''))
}

const PALETTE = {
  w: colors.pixelArt.wood, // dark wooden rail — anchors the border, contrasts the trinkets
  f: colors.pixelArt.teal, // the felt line
  c: colors.muted2, // seat cushions
  g: colors.gold, // chips
  p: colors.pixelArt.purple, // chips
  r: colors.pixelArt.rose, // chips
  o: colors.text, // cards, dice, martini, dealer button
  e: colors.danger, // under the table
}

export default function SportsbookPokerTableBackdrop() {
  // Window size is a first-frame fallback only (no pop-in); once onLayout
  // reports the real content size it wins outright — the window is TALLER
  // than the scroll area (tab bar), so clamping to it would push the bottom
  // rail off-screen. The screen's flexGrow content guarantees at least
  // viewport height when every section is collapsed.
  const window = useWindowDimensions()
  const [size, setSize] = useState({ width: 0, height: 0 })
  const cols = Math.ceil((size.width || window.width) / PIXEL)
  const rowCount = Math.ceil((size.height || window.height) / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 20) return null
    return { rows: buildTable(cols, rowCount), palette: PALETTE }
  }, [cols, rowCount])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize(e.nativeEvent.layout)}
    >
      {grid && (
        <View style={styles.table}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  table: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
