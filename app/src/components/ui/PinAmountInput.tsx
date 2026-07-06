import { TextInput, StyleSheet, StyleProp, TextStyle } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  value: string
  // Receives the already-filtered digit string (or digits + one '.' when
  // allowDecimal) — callers store it straight into state.
  onChangeText: (text: string) => void
  placeholder?: string
  // Typography tier on the shared input box: 'form' = quiet form field
  // (barlow 15) · 'stake' = PvP/loan stake entry (condensed 18) · 'wager' =
  // the betting slip (condensed 20, spaced) · 'big' = headline pledge
  // (condensedHeavy 22).
  variant?: 'form' | 'stake' | 'wager' | 'big'
  // Accept one decimal point (prop-line settle values); switches the keyboard.
  allowDecimal?: boolean
  maxLength?: number
  editable?: boolean
  autoFocus?: boolean
  // Layout-only overrides from the caller (flex, margins) — typography and the
  // box belong to the variant.
  style?: StyleProp<TextStyle>
}

// The numeric pin-amount field: one owner for the digit filter, number-pad
// keyboard, and the shared input box — previously re-declared per screen/sheet.
export default function PinAmountInput({
  value, onChangeText, placeholder, variant = 'form', allowDecimal, maxLength, editable, autoFocus, style,
}: Props) {
  function onText(v: string) {
    onChangeText(
      allowDecimal
        ? v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
        : v.replace(/[^0-9]/g, ''),
    )
  }

  return (
    <TextInput
      style={[styles.box, styles[variant], style]}
      value={value}
      onChangeText={onText}
      keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
      placeholder={placeholder}
      placeholderTextColor={colors.muted2}
      maxLength={maxLength}
      editable={editable}
      autoFocus={autoFocus}
    />
  )
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
  },
  form: { fontFamily: fonts.barlow, fontSize: 15 },
  stake: { fontFamily: fonts.barlowCondensed, fontSize: 18 },
  wager: { fontFamily: fonts.barlowCondensed, fontSize: 20, letterSpacing: 1 },
  big: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 22 },
})
