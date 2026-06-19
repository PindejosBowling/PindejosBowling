import { useCallback } from 'react'
import { TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { colors, fonts } from '../../theme'
import { useUiStore } from '../../stores/uiStore'

// Header button that toggles the full-screen artwork reveal: mostly transparent
// when off, accent-colored when on. Lives top-right of AppHeader (next to the
// profile) and ScreenHeader on every screen with a pixel-art backdrop. When on,
// the screen hides its foreground UI (it reads `artworkReveal` from uiStore) so
// the backdrop shows in full. Resets to off on blur so navigating away never
// leaves a screen with its content hidden.
export default function ArtworkToggle() {
  const revealed = useUiStore(s => s.artworkReveal)
  const set = useUiStore(s => s.set)

  useFocusEffect(
    useCallback(() => () => set({ artworkReveal: false }), [set]),
  )

  return (
    <TouchableOpacity
      onPress={() => set({ artworkReveal: !revealed })}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.pill, revealed && styles.pillOn]}
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Hide artwork' : 'Reveal artwork'}
      accessibilityState={{ selected: revealed }}
    >
      <Text style={[styles.label, revealed && styles.labelOn]}>ART</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.35, // mostly transparent when off
  },
  pillOn: {
    opacity: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.text,
  },
  labelOn: { color: colors.accent },
})
