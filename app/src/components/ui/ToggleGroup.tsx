import { View, ScrollView, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts, radius } from '../../theme'

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
  // pills on a surface background (the PillFilter look). 'bar': a full-width
  // segmented control — equal-width segments inside a filled surface2 track, the
  // active segment washed accent (the modern iOS-style switcher).
  variant?: 'segment' | 'pill' | 'bar'
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

  const bar = variant === 'bar'

  const buttons = options.map((opt) => {
    const active = opt.key === value
    return (
      <TouchableOpacity
        key={opt.key}
        style={[
          bar ? styles.barBtn : variant === 'pill' ? styles.pill : styles.btn,
          active && (bar ? styles.barBtnActive : styles.btnActive),
        ]}
        onPress={() => onChange(opt.key)}
        activeOpacity={0.7}
      >
        <Text style={[styles.btnText, active && styles.btnTextActive]}>{opt.label}</Text>
      </TouchableOpacity>
    )
  })

  // Full-width segmented control: equal-width segments in a filled track.
  if (bar) {
    return <View style={[styles.barTrack, style]}>{buttons}</View>
  }

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
  // Full-width segmented control ('bar').
  barTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  barBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.cardSm,
    alignItems: 'center',
  },
  barBtnActive: { backgroundColor: colors.accentDim },
  btnText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  btnTextActive: { color: colors.accent },
  empty: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
})
