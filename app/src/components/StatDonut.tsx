import { View, Text, StyleSheet } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { colors, fonts } from '../theme'

interface Props {
  /** Fraction filled, 0..1. */
  value: number
  /** Big text in the middle (e.g. "10%"). */
  valueText: string
  /** Caption under the donut. */
  label: string
  color: string
  size?: number
}

export default function StatDonut({ value, valueText, label, color, size = 86 }: Props) {
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, value)) * c
  const center = size / 2

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={center} cy={center} r={r} stroke={colors.surface3} strokeWidth={stroke} fill="none" />
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            // Start the arc at 12 o'clock.
            transform={`rotate(-90 ${center} ${center})`}
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.centerWrap]}>
          <Text style={styles.value}>{valueText}</Text>
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  centerWrap: { alignItems: 'center', justifyContent: 'center' },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },
})
