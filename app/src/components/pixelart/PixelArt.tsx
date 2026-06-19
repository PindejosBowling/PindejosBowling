import { useMemo } from 'react'
import Svg, { Rect } from 'react-native-svg'

export type PixelGrid = {
  /** Rows of equal length; each char keys into `palette`, '.' is transparent. */
  rows: string[]
  palette: Record<string, string>
}

type Props = {
  grid: PixelGrid
  pixelSize: number
}

/** Renders a pixel grid as one SVG rect per filled cell. Purely presentational. */
export default function PixelArt({ grid, pixelSize }: Props) {
  const rects = useMemo(() => {
    const out: { key: string; x: number; y: number; fill: string }[] = []
    grid.rows.forEach((row, y) => {
      Array.from(row).forEach((ch, x) => {
        const fill = grid.palette[ch]
        if (fill) out.push({ key: `${x},${y}`, x: x * pixelSize, y: y * pixelSize, fill })
      })
    })
    return out
  }, [grid, pixelSize])

  const cols = grid.rows.reduce((max, row) => Math.max(max, row.length), 0)
  return (
    <Svg width={cols * pixelSize} height={grid.rows.length * pixelSize}>
      {rects.map(r => (
        <Rect key={r.key} x={r.x} y={r.y} width={pixelSize} height={pixelSize} fill={r.fill} />
      ))}
    </Svg>
  )
}
