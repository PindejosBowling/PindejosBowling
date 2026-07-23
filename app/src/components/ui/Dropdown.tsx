import { useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, StyleProp, TextStyle, ViewStyle, useWindowDimensions,
} from 'react-native'
import { colors, fonts, radius } from '../../theme'
import type { Option as BaseOption } from './ToggleGroup'

interface Option<T extends string> extends BaseOption<T> {
  // Optional accent for this option — when set, the trigger (while selected) and
  // the menu row use `color` for text and `tint` as a translucent background.
  color?: string
  tint?: string
}

interface DropdownProps<T extends string = string> {
  options: Option<T>[]
  value: T
  onChange: (key: T) => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  // Restyles the trigger label so the dropdown can adopt the type language of
  // its host (e.g. the small-caps tag on the Pinsino balance card). Menu rows
  // keep the standard menu type regardless.
  triggerTextStyle?: StyleProp<TextStyle>
  // Restyles the ▾ affordance — e.g. an accent, larger caret when the trigger
  // needs a more prominent "this is tappable" cue.
  caretStyle?: StyleProp<TextStyle>
}

// Compact anchored dropdown menu. Renders a bordered trigger showing the current
// selection; tapping opens a small floating menu positioned beneath the trigger
// (in a transparent Modal so it overlays everything). Picking an option fires
// onChange and closes. Generic over the option key type.
export default function Dropdown<T extends string = string>({
  options,
  value,
  onChange,
  disabled,
  style,
  triggerTextStyle,
  caretStyle,
}: DropdownProps<T>) {
  const triggerRef = useRef<View>(null)
  const { width: screenW } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 })

  const selected = options.find(o => o.key === value)

  function openMenu() {
    if (disabled) return
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setOpen(true)
    })
  }

  const MENU_MIN_WIDTH = 160
  // Keep the menu on-screen: right-align it if anchoring left would overflow.
  const left = Math.min(anchor.x, screenW - MENU_MIN_WIDTH - 8)

  return (
    <>
      <TouchableOpacity
        ref={triggerRef}
        style={[
          styles.trigger,
          selected?.tint ? { backgroundColor: selected.tint, borderColor: selected.tint } : null,
          disabled && styles.triggerDisabled,
          style,
        ]}
        onPress={openMenu}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text style={[styles.triggerText, triggerTextStyle, selected?.color ? { color: selected.color } : null]} numberOfLines={1}>
          {selected?.label ?? '—'}
        </Text>
        <Text style={[styles.caret, selected?.color ? { color: selected.color } : null, caretStyle]}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.menu,
              { position: 'absolute', top: anchor.y + anchor.height + 4, left, minWidth: Math.max(anchor.width, MENU_MIN_WIDTH) },
            ]}
          >
            {options.map(opt => {
              const active = opt.key === value
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={styles.item}
                  onPress={() => { setOpen(false); onChange(opt.key) }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.itemText, active && styles.itemTextActive, opt.color ? { color: opt.color } : null]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                  {active && <Text style={[styles.check, opt.color ? { color: opt.color } : null]}>✓</Text>}
                </TouchableOpacity>
              )
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface2,
  },
  triggerDisabled: { opacity: 0.5 },
  triggerText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.text, letterSpacing: 0.4 },
  caret: { fontFamily: fonts.barlowCondensed, fontSize: 11, color: colors.muted, marginTop: 1 },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingVertical: 4,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.4 },
  itemTextActive: { color: colors.accent },
  check: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.accent },
})
