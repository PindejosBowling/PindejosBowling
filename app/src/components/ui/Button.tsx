import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native'
import { colors, fonts, radius } from '../../theme'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'outline'
type Size = 'md' | 'lg'
type Tone = 'default' | 'danger'

interface ButtonProps {
  label?: string          // required for normal buttons; ignored when `selectable`
  onPress: () => void
  variant?: Variant       // default 'primary'
  size?: Size             // default 'md' (12/15); 'lg' = 14/16 for prominent confirms
  tone?: Tone             // 'danger' recolors the 'outline' variant's border + label
  loading?: boolean       // renders an ActivityIndicator in place of the label
  disabled?: boolean      // applies opacity 0.4 and blocks onPress
  fullWidth?: boolean     // flex:1 for buttons sharing a row
  // Select-field trigger mode: renders a form-field-styled row showing `value`
  // (or muted `placeholder`) with a chevron. Tap fires onPress (open a picker).
  selectable?: boolean
  value?: string | null
  placeholder?: string
  style?: StyleProp<ViewStyle>
}

// Filled variants paint a solid background and use colors.bg for text/spinner.
const FILLED: Variant[] = ['primary', 'danger', 'gold']

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  tone = 'default',
  loading = false,
  disabled = false,
  fullWidth = false,
  selectable = false,
  value,
  placeholder,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading

  // Select-field trigger: a tappable, form-field-styled row (value/placeholder + chevron).
  if (selectable) {
    const hasValue = value != null && value !== ''
    return (
      <TouchableOpacity
        style={[styles.select, fullWidth && styles.fullWidth, isDisabled && styles.disabled, style]}
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.7}
      >
        <Text style={[styles.selectText, !hasValue && styles.selectPlaceholder]} numberOfLines={1}>
          {hasValue ? value : placeholder}
        </Text>
        <Text style={styles.selectChevron}>›</Text>
      </TouchableOpacity>
    )
  }

  const isFilled = FILLED.includes(variant)
  const spinnerColor = isFilled ? colors.bg : colors.muted
  const dangerOutline = variant === 'outline' && tone === 'danger'

  return (
    <TouchableOpacity
      style={[
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        dangerOutline && styles.outlineDanger,
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
        <Text style={[styles.label, labelSizeStyles[size], labelVariantStyles[variant], dangerOutline && styles.outlineDangerLabel]}>
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
  // tone="danger" overrides for the outline variant.
  outlineDanger: { borderColor: colors.danger },
  outlineDangerLabel: { color: colors.danger },
  // Select-field trigger mode.
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  selectText: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, flex: 1, marginRight: 8 },
  selectPlaceholder: { color: colors.muted2 },
  selectChevron: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.muted, marginTop: -1 },
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
  // Outline = surface-filled bordered button with a colored label; fixed 13pt.
  outline: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingVertical: 13,
  },
})

const labelVariantStyles = StyleSheet.create({
  primary: { color: colors.bg, fontWeight: '700' },
  danger: { color: colors.bg, fontWeight: '700' },
  gold: { color: colors.bg, fontWeight: '700' },
  secondary: { color: colors.muted },
  ghost: { color: colors.muted, fontSize: 14 },
  outline: { color: colors.text },
})
