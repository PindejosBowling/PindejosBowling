import { ScrollView, TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts } from '../theme'

interface PillFilterProps {
  items: string[]
  value: string
  onChange: (item: string) => void
  renderLabel?: (item: string) => string
  style?: StyleProp<ViewStyle>
}

export default function PillFilter({ items, value, onChange, renderLabel, style }: PillFilterProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.pillRow, style]}
    >
      {items.map((item) => {
        const active = item === value
        return (
          <TouchableOpacity
            key={item}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(item)}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
              {renderLabel ? renderLabel(item) : item}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  pillText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  pillTextActive: { color: colors.accent },
})
