// Shared sprite helpers for the pixel-art backdrops. Every backdrop composes
// its scene by stamping small named sprites onto a '.'-filled canvas (and
// generating atmosphere procedurally with a per-cell hash); these are the
// primitives they share. The fixed-scene renderer (PixelArtBackdrop + a SCENES
// catalog) that used to live here was retired when the last anchored scene
// graduated to a bespoke full-viewport backdrop.

export type Sprite = string[]

/** Stamp a sprite onto a mutable canvas, clipping at the edges. */
export function stamp(canvas: string[][], sprite: Sprite, x: number, y: number) {
  const rowCount = canvas.length
  const cols = canvas[0]?.length ?? 0
  sprite.forEach((row, dy) => {
    Array.from(row).forEach((ch, dx) => {
      const cx = x + dx
      const cy = y + dy
      if (ch !== '.' && cy >= 0 && cy < rowCount && cx >= 0 && cx < cols) canvas[cy][cx] = ch
    })
  })
}

/** Swap palette keys so one sprite can be reused in different colors. */
export function rekey(sprite: Sprite, map: Record<string, string>): Sprite {
  return sprite.map(row => Array.from(row).map(ch => map[ch] ?? ch).join(''))
}
