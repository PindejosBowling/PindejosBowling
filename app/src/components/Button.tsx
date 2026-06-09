import React from 'react'
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native'
import { colors, fonts, radius } from '../theme'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'
type Size = 'md' | 'lg'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: Variant       // default 'primary'
  size?: Size             // default 'md' (12/15); 'lg' = 14/16 for prominent confirms
  loading?: boolean       // renders an ActivityIndicator in place of the label
  disabled?: boolean      // applies opacity 0.4 and blocks onPress
  fullWidth?: boolean     // flex:1 for buttons sharing a row
  style?: StyleProp<ViewStyle>
}

// Filled variants paint a solid background and use colors.bg for text/spinner.
const FILLED: Variant[] = ['primary', 'danger', 'gold']

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const isFilled = FILLED.includes(variant)
  const isDisabled = disabled || loading
  const spinnerColor = isFilled ? colors.bg : colors.muted

  return (
    <TouchableOpacity
      style={[
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Text style={[styles.label, labelSizeStyles[size], labelVariantStyles[variant]]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.cardSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { flex: 1 },
  disabled: { opacity: 0.4 },
  label: {
    fontFamily: fonts.barlowCondensed,
    letterSpacing: 0.5,
  },
})

const sizeStyles = StyleSheet.create({
  md: { paddingVertical: 12 },
  lg: { paddingVertical: 14 },
})

const labelSizeStyles = StyleSheet.create({
  md: { fontSize: 15 },
  lg: { fontSize: 16 },
})

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.danger },
  gold: { backgroundColor: colors.gold },
  secondary: { borderWidth: 1, borderColor: colors.border2 },
  // Ghost is a borderless text button (e.g. the plain "Cancel"); fixed 14pt,
  // ignores the size scale.
  ghost: { paddingVertical: 14, borderRadius: 0 },
})

const labelVariantStyles = StyleSheet.create({
  primary: { color: colors.bg, fontWeight: '700' },
  danger: { color: colors.bg, fontWeight: '700' },
  gold: { color: colors.bg, fontWeight: '700' },
  secondary: { color: colors.muted },
  ghost: { color: colors.muted, fontSize: 14 },
})
