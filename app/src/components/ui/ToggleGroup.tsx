import { View, ScrollView, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts } from '../../theme'

export interface Option<T extends string = string> {
  key: T
  label: string
}

interface ToggleGroupProps<T extends string = string> {
  options: Option<T>[]
  // null = nothing selected yet (e.g. GamePicker before a game is chosen).
  value: T | null
  onChange: (key: T) => void
  // Rendered as muted text when `options` is empty.
  empty?: string
  // 'segment' (default): bordered radius-8 row pills. 'pill': radius-20 filter
  // pills on a surface background (the PillFilter look).
  variant?: 'segment' | 'pill'
  // Render the pills inside a horizontal ScrollView (long filter bars).
  scrollable?: boolean
  // Applied to the row (the ScrollView content container when scrollable).
  style?: StyleProp<ViewStyle>
}

export default function ToggleGroup<T extends string = string>({
  options,
  value,
  onChange,
  empty,
  variant = 'segment',
  scrollable,
  style,
}: ToggleGroupProps<T>) {
  if (options.length === 0) {
    return empty ? <Text style={styles.empty}>{empty}</Text> : null
  }

  const buttons = options.map((opt) => {
    const active = opt.key === value
    return (
      <TouchableOpacity
        key={opt.key}
        style={[variant === 'pill' ? styles.pill : styles.btn, active && styles.btnActive]}
        onPress={() => onChange(opt.key)}
        activeOpacity={0.7}
      >
        <Text style={[styles.btnText, active && styles.btnTextActive]}>{opt.label}</Text>
      </TouchableOpacity>
    )
  })

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollRow, style]}
      >
        {buttons}
      </ScrollView>
    )
  }
  return <View style={[styles.group, style]}>{buttons}</View>
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: 8, justifyContent: 'space-around' },
  scroll: { flexGrow: 0 },
  scrollRow: { flexDirection: 'row', gap: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface,
  },
  btnActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  btnText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  btnTextActive: { color: colors.accent },
  empty: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
})
