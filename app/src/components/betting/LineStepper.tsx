import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface LineStepperProps {
  // The displayed half-point value (the number the bettor intends to beat).
  value: number
  // Fires with a snapped (X.5), band-clamped value — from an arrow nudge or a
  // committed type-in.
  onChange: (v: number) => void
  // The priceable half-point band (from the preview RPC); null until the
  // first quote lands — stepping is allowed meanwhile, the next quote clamps.
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

// The shared ◀ value ▶ cluster behind value-first line entry — used inline in
// every board LinePill and in the combo BuilderBar. Arrows nudge ±0.5 inside
// the priceable band; tapping the number opens the numeric keyboard for
// direct entry (commit on blur/submit — Android's decimal pad has no reliable
// submit key). The parent owns the value and prices it (debounced preview).
export default function LineStepper({
  value,
  onChange,
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

  const nudge = (dir: 1 | -1) => {
    if (disabled) return
    onChange(clamp(snapToHalf(value) + dir * 0.5))
  }

  const commit = () => {
    const raw = text
    setText(null)
    if (raw == null) return
    const n = parseFloat(raw.replace(',', '.'))
    if (isNaN(n)) return // garbage → revert to the previous value
    onChange(clamp(snapToHalf(n)))
  }

  const atMin = min != null && value <= min
  const atMax = max != null && value >= max
  const textColor = onFill ? colors.bg : colors.text
  const arrowColor = onFill ? colors.bg : colors.accent

  return (
    <View style={styles.cluster}>
      <TouchableOpacity
        onPress={() => nudge(-1)}
        disabled={disabled || atMin}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        activeOpacity={0.6}
        style={(disabled || atMin) && styles.arrowDisabled}
      >
        <Text style={[styles.arrow, { color: arrowColor }]}>◀</Text>
      </TouchableOpacity>
      {editing ? (
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
          returnKeyType="done"
        />
      ) : (
        <TouchableOpacity
          onPress={disabled ? undefined : () => setText(value.toFixed(1))}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.value, { color: textColor }]}>
            {value.toFixed(1)}{suffix}
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={() => nudge(1)}
        disabled={disabled || atMax}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
        activeOpacity={0.6}
        style={(disabled || atMax) && styles.arrowDisabled}
      >
        <Text style={[styles.arrow, { color: arrowColor }]}>▶</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: { fontSize: 11 },
  arrowDisabled: { opacity: 0.3 },
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
})
