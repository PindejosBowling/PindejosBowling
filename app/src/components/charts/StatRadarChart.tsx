import { View, Text, StyleSheet } from 'react-native'
import Svg, { Polygon, Line, Circle } from 'react-native-svg'
import { colors, fonts } from '../../theme'

export interface RadarAxis {
  label: string
  valueText: string
  /** Normalized 0..1 distance from center (already scaled per metric). */
  radial: number
}

interface Props {
  axes: RadarAxis[]
  /** Diameter of the web (label area is added around it). */
  size?: number
}

const RINGS = [0.25, 0.5, 0.75, 1]

// Point on a spoke: angle starts at the top (-90°) and goes clockwise.
function point(cx: number, cy: number, r: number, index: number, count: number) {
  const angle = (-90 + (index * 360) / count) * (Math.PI / 180)
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

export default function StatRadarChart({ axes, size = 150 }: Props) {
  const n = axes.length
  const padX = 70   // room for side labels
  const padY = 46   // room for top/bottom labels
  const W = size + padX * 2
  const H = size + padY * 2
  const cx = W / 2
  const cy = H / 2
  const R = size / 2

  const toXY = (r: number, i: number) => point(cx, cy, r, i, n)

  const dataPoints = axes
    .map((a, i) => { const p = toXY(R * clamp01(a.radial), i); return `${p.x},${p.y}` })
    .join(' ')

  return (
    <View style={{ width: W, height: H }}>
      <Svg width={W} height={H}>
        {/* Concentric rings */}
        {RINGS.map((frac) => (
          <Polygon
            key={frac}
            points={axes.map((_, i) => { const p = toXY(R * frac, i); return `${p.x},${p.y}` }).join(' ')}
            fill="none"
            stroke={colors.border2}
            strokeWidth={1}
          />
        ))}
        {/* Spokes */}
        {axes.map((_, i) => {
          const p = toXY(R, i)
          return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={colors.border2} strokeWidth={1} />
        })}
        {/* Data polygon */}
        <Polygon points={dataPoints} fill={colors.accentDim} stroke={colors.accent} strokeWidth={2} />
        {axes.map((a, i) => {
          const p = toXY(R * clamp01(a.radial), i)
          return <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={colors.accent} />
        })}
      </Svg>

      {/* Two-line labels positioned just outside each spoke tip */}
      {axes.map((a, i) => {
        const p = toXY(R + 22, i)
        return (
          <View key={i} style={[styles.label, { left: p.x - LABEL_W / 2, top: p.y - LABEL_H / 2 }]}>
            <Text style={styles.labelName} numberOfLines={1}>{a.label}</Text>
            <Text style={styles.labelValue} numberOfLines={1}>{a.valueText}</Text>
          </View>
        )
      })}
    </View>
  )
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

const LABEL_W = 96
const LABEL_H = 40

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    width: LABEL_W,
    height: LABEL_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
  },
})
