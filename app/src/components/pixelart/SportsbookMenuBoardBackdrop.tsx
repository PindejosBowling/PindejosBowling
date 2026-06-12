import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Scroll-length marquee "menu board" for the Sportsbook. The whole page is
// framed as one tall illuminated menu board: a bulb-studded header panel sized
// to wrap the title + view pills, side rails running the full scroll length to
// tie the page together, and a closing rail at the very bottom. The interior
// stays empty — the betting lines ARE the menu. Mount as the first child
// INSIDE the ScrollView (with the ScreenHeader also inside — the mounting
// standard in ./config.ts); it measures itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.scrollField

// Height of the header section below the status-bar inset: ScreenHeader
// (~52px) + the view ToggleGroup (~36px), with the rail seated in the
// toggle's 20px bottom margin gap so it never crosses the pills. The safe-area
// inset is added at runtime — the field starts at the bezel, the header at
// the inset.
const HEADER_PANEL_PX = 96

// Bulb cadences along the frame (cells between gold bulbs).
const RAIL_BULB_EVERY = 6 // side rails below the panel
const PANEL_BULB_EVERY = 3 // side rails beside the header panel
const ROW_BULB_EVERY = 4 // horizontal rails

function buildBoard(cols: number, rowCount: number, topInsetPx: number): string[] {
  const rows = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  const panelRow = Math.round((topInsetPx + HEADER_PANEL_PX) / PIXEL)

  // Horizontal rails: top of the board, under the header panel, page bottom.
  const railRow = (y: number) => {
    for (let x = 0; x < cols; x++) rows[y][x] = x % ROW_BULB_EVERY === 1 ? 'g' : 'k'
  }
  railRow(0)
  railRow(panelRow)
  railRow(rowCount - 1)

  // Side rails: bulbs denser beside the header panel, sparser down the page.
  for (let y = 1; y < rowCount - 1; y++) {
    if (y === panelRow) continue
    const lit = y <= panelRow ? y % PANEL_BULB_EVERY === 1 : y % RAIL_BULB_EVERY === 3
    const ch = lit ? 'g' : 'k'
    rows[y][0] = ch
    rows[y][cols - 1] = ch
  }

  // Corner bulbs anchor every frame junction.
  for (const y of [0, panelRow, rowCount - 1]) {
    rows[y][0] = 'g'
    rows[y][cols - 1] = 'g'
  }

  // Menace: a pair of red eyes in the bottom padding, just off the left rail.
  if (rowCount > 8) {
    rows[rowCount - 4][2] = 'e'
    rows[rowCount - 4][4] = 'e'
  }

  return rows.map(r => r.join(''))
}

const PALETTE = {
  k: colors.muted2,
  g: colors.gold,
  e: colors.danger,
}

export default function SportsbookMenuBoardBackdrop() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const insets = useSafeAreaInsets()
  const cols = Math.ceil(size.width / PIXEL)
  const rowCount = Math.ceil(size.height / PIXEL)

  const grid = useMemo<PixelGrid | null>(() => {
    if (cols < 10 || rowCount < 20) return null
    return { rows: buildBoard(cols, rowCount, insets.top), palette: PALETTE }
  }, [cols, rowCount, insets.top])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize(e.nativeEvent.layout)}
    >
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
