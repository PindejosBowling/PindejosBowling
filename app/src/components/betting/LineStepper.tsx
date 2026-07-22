import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface LineStepperProps {
  // The displayed half-point value (the number the bettor intends to beat).
  value: number
  // Fires with a snapped (X.5), band-clamped value on a committed type-in.
  onChange: (v: number) => void
  // Fires the moment the input opens — the parent starts pricing this line
  // so the min–max band is known while the user is still typing.
  onEditStart?: () => void
  // The priceable half-point band (from the preview RPC); null until the
  // first quote lands — typing is allowed meanwhile, the next quote clamps.
  min?: number | null
  max?: number | null
  disabled?: boolean
  // Contrast flip when the host pill is staged (accent fill behind).
  onFill?: boolean
  // The rendered suffix after the number ('+' on board pills).
  suffix?: string
}

// Snap any typed number onto the half-point grid: integers step up to X.5
// ("140" → 140.5), everything else rounds to the nearest X.5. Cosmetic only —
// the pricing/placement RPCs re-validate half-points server-side.
export function snapToHalf(n: number): number {
  return Math.round(n - 0.5) + 0.5
}

// The shared tap-to-type value editor behind value-first line entry — used
// inline in every board LinePill and in the combo BuilderBar. Tapping the
// number opens the numeric keyboard for direct entry (commit on blur/submit —
// Android's decimal pad has no reliable submit key); while typing, the
// priceable min–max band is shown under the input. The parent owns the value
// and prices it (debounced preview).
export default function LineStepper({
  value,
  onChange,
  onEditStart,
  min,
  max,
  disabled,
  onFill,
  suffix = '+',
}: LineStepperProps) {
  const [text, setText] = useState<string | null>(null) // non-null while editing
  const inputRef = useRef<TextInput>(null)
  const editing = text != null

  // An outside value change (re-ladder, staged-pick sync) while not editing
  // just re-renders; while editing, the in-progress text wins until commit.
  useEffect(() => {
    if (!editing) setText(null)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = (v: number) => {
    let out = v
    if (min != null) out = Math.max(out, min)
    if (max != null) out = Math.min(out, max)
    return out
  }

  const commit = () => {
    const raw = text
    setText(null)
    if (raw == null) return
    const n = parseFloat(raw.replace(',', '.'))
    if (isNaN(n)) return // garbage → revert to the previous value
    const next = clamp(snapToHalf(n))
    // A no-op commit stays silent — the blur that happens when the user taps
    // straight into ANOTHER line's editor must not fire onChange, or this
    // market would steal the active edit back and kill the new editor's band.
    if (next === value) return
    onChange(next)
  }

  const textColor = onFill ? colors.bg : colors.text
  const hintColor = onFill ? colors.bg : colors.muted

  return (
    <View style={styles.cluster}>
      {editing ? (
        <View style={styles.editCol}>
          <TextInput
            ref={inputRef}
            style={[styles.value, styles.input, { color: textColor }]}
            value={text}
            onChangeText={setText}
            onBlur={commit}
            onSubmitEditing={commit}
            keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
            autoFocus
            selectTextOnFocus
            // No returnKeyType on iOS: RN pairs number pads + returnKeyType
            // with an auto "Done" accessory toolbar whose invisible spacer
            // swallows every tap in the strip left of the button (dead pills
            // right above the keyboard). Commit is on blur anyway. Android's
            // numeric keyboard has a real Done key — keep it there.
            returnKeyType={Platform.OS === 'ios' ? undefined : 'done'}
          />
          {min != null && max != null && (
            <Text style={[styles.range, { color: hintColor }]}>
              {min.toFixed(1)} – {max.toFixed(1)}
            </Text>
          )}
        </View>
      ) : (
        <TouchableOpacity
          onPress={disabled ? undefined : () => {
            setText(value.toFixed(1))
            onEditStart?.()
          }}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.value, { color: textColor }]}>
            {value.toFixed(1)}{suffix}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center' },
  editCol: { alignItems: 'center' },
  value: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    minWidth: 44,
    textAlign: 'center',
  },
  input: {
    paddingVertical: 0,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.cardSm,
  },
  range: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    marginTop: 2,
    opacity: 0.8,
  },
})
