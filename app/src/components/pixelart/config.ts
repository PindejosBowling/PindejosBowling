// Central configuration for every pixel-art backdrop. All renderers
// (PixelArtBackdrop, PinsinoNoirBackdrop, LoanSharkDepthBackdrop, and any
// future ones) MUST take their cell size and opacity from here so page
// backgrounds stay consistent app-wide.
//
// THE MOUNTING STANDARD — art extends to the very top of the screen:
// - Fixed scenes & viewport fields: mount as the FIRST CHILD inside the
//   screen's SafeAreaView (edges={['top']}), before the header. The layer is
//   absolute-fill and pointerEvents="none", so it sits behind everything.
// - Scroll-length fields (art that must track the scrollable content, e.g.
//   the Loan Shark depth field): mount as the first child INSIDE the
//   ScrollView, and put the ScreenHeader inside the ScrollView too (the
//   Sportsbook pattern) so the scroll content — and therefore the art —
//   starts at the very top of the screen.

/** Cell size (px) for procedural full-bleed fields. */
export const FIELD_PIXEL = 8

/** Opacity ladder. Pick by surface, don't invent new values. */
export const BACKDROP_OPACITY = {
  /** Fixed scenes on sparse screens. */
  scene: 0.12,
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
