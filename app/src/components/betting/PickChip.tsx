import { Text, TouchableOpacity, View, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, radius, type } from '../../theme'

interface PickChipProps {
  // The condition/odds text — '142.5+ PINS', 'WIN', '×3'.
  label: string
  // Optional small second line (e.g. a member's solo line in combine mode).
  sublabel?: string
  // Staged/picked: solid fill (accent, or gold when `gold`), bg-colored text.
  selected?: boolean
  // Dimmed but STILL PRESSABLE (low balance, anti-tank) — the caller's handler
  // runs so it can toast. Pressability is governed only by `inert`/`onPress`.
  disabled?: boolean
  // Not pressable at all (market in progress).
  inert?: boolean
  // Specials treatment: gold border/fill instead of the standard accent.
  gold?: boolean
  // 'lg' = the oversized multiplier / builder CTA cell.
  size?: 'md' | 'lg'
  // Grid item inside a wrapping button set (uniform two-per-line cells).
  grid?: boolean
  // Alt-line ladder stepper: renders ‹ › arrows flanking the label. A null
  // handler renders its arrow dimmed-inert (ladder end); omit the prop
  // entirely for single-rung chips and every non-ladder caller.
  stepper?: { onPrev: (() => void) | null; onNext: (() => void) | null }
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

// The ticket-style pick/odds cell — the one tappable "agree to this line"
// surface shared by the board (LineRow), specials (CustomLineRow), and the
// combine-mode member rows. Quietly neutral at rest (soft white-alpha fill),
// solid accent/gold when selected, so slip contents read at a glance.
export default function PickChip({
  label,
  sublabel,
  selected,
  disabled,
  inert,
  gold,
  size = 'md',
  grid,
  stepper,
  onPress,
  style,
}: PickChipProps) {
  const pressable = !inert && !!onPress
  const arrow = (dir: 'prev' | 'next') => {
    if (!stepper) return null
    const handler = dir === 'prev' ? stepper.onPrev : stepper.onNext
    return (
      <TouchableOpacity
        onPress={handler ?? undefined}
        disabled={!handler || inert}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        style={styles.stepArrow}
        activeOpacity={0.6}
      >
        <Text
          style={[
            styles.stepArrowText,
            selected && styles.textSelected,
            (!handler || inert) && styles.stepArrowDim,
          ]}
        >
          {dir === 'prev' ? '‹' : '›'}
        </Text>
      </TouchableOpacity>
    )
  }
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        size === 'lg' && styles.chipLg,
        grid && styles.chipGridItem,
        gold && styles.chipGold,
        stepper != null && styles.chipStepper,
        selected && (gold ? styles.chipSelectedGold : styles.chipSelected),
        (inert || disabled) && styles.chipDisabled,
        style,
      ]}
      onPress={pressable ? onPress : undefined}
      disabled={!pressable}
      activeOpacity={0.7}
    >
      {arrow('prev')}
      <View style={stepper != null ? styles.stepBody : undefined}>
        <Text
          style={[
            size === 'lg' ? styles.textLg : styles.text,
            gold && styles.textGold,
            selected && styles.textSelected,
          ]}
        >
          {label}
        </Text>
        {sublabel != null && (
          <Text style={[styles.sublabel, selected && styles.textSelected]}>{sublabel}</Text>
        )}
      </View>
      {arrow('next')}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  chip: {
    minWidth: 78,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLg: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  // Uniform two-per-line grid cells inside a wrapping set — equal widths keep
  // the set symmetric under a centered name; an odd last cell centers itself.
  chipGridItem: { flexGrow: 1, flexBasis: '40%', maxWidth: '48%' },
  chipGold: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipSelectedGold: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipDisabled: { borderColor: colors.border2, backgroundColor: 'transparent', opacity: 0.4 },
  text: { ...type.chip, color: 'rgba(240,240,240,0.85)' },
  textLg: { ...type.chipLg, color: colors.accent },
  textGold: { color: colors.gold },
  textSelected: { color: colors.bg },
  sublabel: { ...type.label, color: colors.muted, marginTop: 2 },
  // Ladder stepper: arrows flank a centered label block inside one chip row.
  chipStepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepArrow: { paddingHorizontal: 2 },
  stepArrowText: { ...type.chipLg, color: colors.accent, lineHeight: 20 },
  stepArrowDim: { opacity: 0.25 },
})
