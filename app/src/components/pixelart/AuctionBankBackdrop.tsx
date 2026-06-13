import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../theme'
import PixelArt, { PixelGrid } from './PixelArt'
import { Sprite, stamp, rekey } from './scenes'
import { BACKDROP_OPACITY, FIELD_PIXEL } from './config'

// Auction-floor banner for the Auction House: the whole scene is a band across
// the bottom third of the screen, with everything above left empty so it never
// competes with the cards. The floor is in full cry — an auctioneer stands high
// on a rostrum to the right, brimmed hat on, gavel thrown up mid-call (a gold
// glint on its head), and the whole room is bidding back at him. A deep, packed
// crowd of pin-folk runs along the bottom in mixed colors, jostling at jittered
// heights, shooting tall numbered paddles (gold and lime) way up over their
// heads. The lot stands on the left — a glowing prize raised high on a tall
// pedestal, the room's one promise. A little floor dust hangs in the air,
// thinned over the central column so the lot cards read clean. One pair of red
// eyes watches from the shadows at the back: somebody already knows who wins.
//
// Mount as the first child inside the SafeAreaView (it fills the viewport and
// content scrolls over it); it measures itself via onLayout.

const PIXEL = FIELD_PIXEL
const OPACITY = BACKDROP_OPACITY.field

// The auctioneer — brimmed hat, one arm flung up to the right with the gavel
// at its head. A headline figure: he stands raised behind a lectern, towering
// over the floor.
const AUCTIONEER: Sprite = [
  '.....G', // gavel head
  '....AG', // hand + handle
  '....A.', // forearm
  'kkkkA.', // hat brim + upper arm
  '.kkAA.', // hat crown + shoulder
  '..AAA.', // head
  '.AAAA.', // torso
  '.AAAA.', // torso
  '.AAAA.', // torso
]

// A bid paddle thrown up: a numbered card on a long stick. The card key is
// rebound per paddle so the room flashes both gold and lime.
const PADDLE: Sprite = [
  'PPP',
  'PPP',
  'PPP',
  '.b.',
  '.b.',
  '.b.',
  '.b.',
  '.b.',
]

// Crowd figures — bare pins, no hats. The body key is rebound per figure so
// the crowd comes out in mixed colors.
const BIDDER: Sprite = [
  '.p.',
  '.p.',
  '.p.',
  'ppp',
  'ppp',
  'ppp',
]

// The same pin with both arms thrown up, shouting a bid.
const SHOUTING: Sprite = [
  'p.p',
  '.p.',
  '.p.',
  'ppp',
  'ppp',
  'ppp',
]

// A shorter pin pushed up to the front row.
const KID: Sprite = [
  '.p.',
  '.p.',
  'ppp',
  'ppp',
  'ppp',
]

const EYES: Sprite = ['e.e']

// The lot: a glowing prize raised on a wooden pedestal of a given total
// height, so it stands clear over the bidders' heads and into the action zone.
function lotPedestal(totalH: number): Sprite {
  const rows = ['.o.', 'ggg', 'ggg', 'ggg']
  for (let i = rows.length; i < totalH - 2; i++) rows.push('.c.')
  rows.push('ccc', 'ccc')
  return rows
}

// Deterministic per-cell hash so the scene is stable across renders.
function hash(x: number, y: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663)) >>> 0
}

// Crowd tints cycle through the soft pixelArt palette.
const CROWD_KEYS = ['p', 'r', 't'] as const

function buildScene(cols: number, rowCount: number): string[] {
  const canvas = Array.from({ length: rowCount }, () => Array<string>(cols).fill('.'))
  const floor = rowCount - 3
  // The action fills the bottom third of the screen; everything below scales
  // off this so the staging tracks the lower third on any device.
  const stage = Math.floor(rowCount * 0.33)
  const isCentral = (x: number) => x > cols * 0.34 && x < cols * 0.66

  // A little dust on the floor — sparse, confined to the action zone and
  // thinned over the central column. Everything above the action zone stays
  // empty: this scene is a banner across the bottom third only.
  const stageTop = floor - stage
  for (let x = 0; x < cols; x++) {
    const central = isCentral(x)
    for (let y = stageTop; y < floor; y++) {
      if (hash(x, y) % 1000 < (central ? 2 : 4)) canvas[y][x] = 'u'
    }
  }

  // The lot, raised tall so its prize sits high in the action zone.
  const pedX = Math.floor(cols * 0.2)
  const lotH = Math.min(stage - 2, Math.max(12, Math.floor(stage * 0.72)))
  const PED = lotPedestal(lotH)
  const pedTop = floor - PED.length

  // Floorboards: a full-width line with specks of grain below it.
  for (let x = 0; x < cols; x++) {
    canvas[floor][x] = 'c'
    for (let y = floor + 1; y < rowCount; y++) {
      if (hash(x, y) % 100 < 8) canvas[y][x] = 'c'
    }
  }

  // The lot under the spotlight: a glowing prize raised on its pedestal.
  stamp(canvas, PED, pedX - 1, pedTop)

  // The auctioneer's rostrum on the right — a high wooden pulpit he stands on
  // so he towers over the floor, with a lectern lip at its front edge that he
  // calls over.
  const rostX = Math.floor(cols * 0.72)
  const rostW = 8
  const rostH = Math.min(floor - 6, Math.max(8, Math.floor(stage * 0.52)))
  const podTop = floor - rostH
  for (let bx = rostX; bx < Math.min(rostX + rostW, cols); bx++) {
    for (let y = podTop; y < floor; y++) canvas[y][bx] = 'c'
  }
  stamp(canvas, AUCTIONEER, rostX + 2, podTop - AUCTIONEER.length)
  // Lectern lip: two columns rising a touch above the rostrum, in front of him.
  for (let ly = podTop - 2; ly < podTop; ly++) {
    canvas[ly][rostX + 2] = 'c'
    canvas[ly][rostX + 3] = 'c'
  }

  // Columns where the lot and the rostrum stand — the crowd packs in front of
  // them but throws no paddles up here, so neither feature gets buried.
  const overFeature = (x: number) =>
    (x >= pedX - 2 && x <= pedX + 2) || (x >= rostX - 1 && x <= rostX + rostW)

  // A back rank of bidders, drawn first and stood a little higher so the front
  // rank occludes their feet — that read of depth packs the crowd out.
  for (let i = 0; i < Math.floor((cols - 2) / 3); i++) {
    const fx = 3 + i * 3 + (hash(i, 53) % 2)
    if (fx < 1 || fx > cols - 4 || isCentral(fx)) continue
    const key = CROWD_KEYS[(i + 1) % 3]
    const figure = hash(i, 23) % 100 < 50 ? SHOUTING : BIDDER
    stamp(canvas, rekey(figure, { p: key }), fx, floor - 6 - 3)
  }

  // The front rank — packed, jittered, mixed colors; the short ones up front,
  // a chunk of them shouting, and roughly half shooting a tall numbered paddle
  // way up over their heads (none in the central sightline or over the
  // lot/rostrum, where tall paddles would crowd the lot cards or bury the
  // headline figures).
  const count = Math.floor((cols - 2) / 3)
  for (let i = 0; i < count; i++) {
    const fx = 1 + i * 3 + (hash(i, 13) % 2)
    if (fx < 1 || fx > cols - 4) continue
    const central = isCentral(fx)
    const noPaddle = central || overFeature(fx)
    const short = central || hash(i, 19) % 100 < 30
    const shout = !short && hash(i, 29) % 100 < 45
    const key = CROWD_KEYS[i % 3]
    const figure = short ? KID : shout ? SHOUTING : BIDDER
    const fh = figure.length
    stamp(canvas, rekey(figure, { p: key }), fx, floor - fh)
    // A raised paddle over roughly half the crowd, shot up to a jittered
    // height across the action zone for the chaos.
    if (!noPaddle && hash(i, 37) % 100 < 65) {
      const cardKey = i % 2 === 0 ? 'g' : 'a'
      const raise = hash(i, 41) % Math.max(4, Math.floor(stage * 0.6))
      stamp(canvas, rekey(PADDLE, { P: cardKey }), fx, floor - fh - 3 - raise)
    }
  }

  // Red eyes watching from the shadows at the back, off to one side.
  stamp(canvas, EYES, cols - 4, floor - 6)

  return canvas.map(r => r.join(''))
}

const PALETTE = {
  A: colors.pixelArt.sand, // the auctioneer
  k: colors.muted2, // his hat
  G: colors.gold, // the gavel head
  g: colors.gold, // prize, gold paddles, lamp bulbs
  o: colors.text, // the prize's glint
  c: colors.pixelArt.wood, // pedestal, rostrum, lectern, floorboards
  b: colors.muted, // paddle sticks
  a: colors.accent, // lime paddles
  u: colors.pixelArt.sand, // dust + spotlight cone
  p: colors.pixelArt.purple, // crowd
  r: colors.pixelArt.rose, // crowd
  t: colors.pixelArt.teal, // crowd
  e: colors.danger, // the eyes in the shadows
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
        <View style={styles.house}>
          <PixelArt grid={grid} pixelSize={PIXEL} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  house: { position: 'absolute', top: 0, left: 0, opacity: OPACITY },
})
