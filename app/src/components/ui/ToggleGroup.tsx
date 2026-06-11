import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts } from '../../theme'

interface Option<T extends string> {
  key: T
  label: string
}

interface ToggleGroupProps<T extends string = string> {
  options: Option<T>[]
  value: T
  onChange: (key: T) => void
  style?: StyleProp<ViewStyle>
}

export default function ToggleGroup<T extends string = string>({
  options,
  value,
  onChange,
  style,
}: ToggleGroupProps<T>) {
  return (
    <View style={[styles.group, style]}>
      {options.map((opt) => {
        const active = opt.key === value
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.btn, active && styles.btnActive]}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.btnText, active && styles.btnTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: 8, justifyContent: 'space-around' },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  btnActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  btnText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  btnTextActive: { color: colors.accent },
})
