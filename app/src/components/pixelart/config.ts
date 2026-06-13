// Central configuration for every pixel-art backdrop. All renderers
// (PixelArtBackdrop, PinsinoNoirBackdrop, LoanSharkDepthBackdrop, and any
// future ones) MUST take their cell size and opacity from here so page
// backgrounds stay consistent app-wide.
//
// THE MOUNTING STANDARD — art extends to the very top of the screen (the
// physical bezel, painting under the status bar), and headers carry NO
// background so the art shows through them:
// - Fixed scenes & viewport fields: mount as the FIRST CHILD inside the
//   screen's SafeAreaView (edges={['top']}), before the header. The layer is
//   absolute-fill and pointerEvents="none"; absolute children ignore the
//   SafeAreaView's inset padding, so the art reaches the bezel.
// - Scroll-length fields (art that must track the scrollable content, e.g.
//   the Loan Shark depth field, the Sportsbook menu board): mount as the
//   first child INSIDE the ScrollView, with the ScreenHeader inside the
//   ScrollView too. The screen uses a plain View + `paddingTop: insets.top`
//   on the scroll content INSTEAD of a top-edge SafeAreaView — otherwise the
//   content (and the art with it) would start below the notch. Fields that
//   frame the header must add `insets.top` to their header-zone math.

/** Cell size (px) for procedural full-bleed fields. */
export const FIELD_PIXEL = 8

/** Opacity ladder. Pick by surface, don't invent new values. */
export const BACKDROP_OPACITY = {
  /** Fixed scenes on sparse screens. */
  scene: 0.12,
  /** Hero scenes — compositions that ARE the screen's ambience (e.g. the
   *  full-viewport PvP shootout). The loudest fixed-scene rung. */
  sceneHero: 0.18,
  /** Fixed scenes on dense screens (tables/ledgers) — the quietest. */
  sceneDense: 0.08,
  /** Viewport-filling procedural fields (whole-screen ambience). */
  field: 0.12,
  /** Scroll-length procedural fields (art lives in the gutters/gaps). */
  scrollField: 0.22,
}

/** Vertical inset for `topRight`-anchored scenes so they clear the header. */
export const TOP_ANCHOR_INSET = 120

/** Horizontal inset for corner-anchored scenes. */
export const EDGE_INSET = 12
