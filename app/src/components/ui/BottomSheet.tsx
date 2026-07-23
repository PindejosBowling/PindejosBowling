import { ReactNode } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native'
import { colors, fonts } from '../../theme'
import Toast from './Toast'

// Room reserved above the scrolling body for the sheet chrome (title, subtitle,
// footer, padding) plus a small gap so the sheet never runs under the status
// bar. The body fills the rest of the screen, then scrolls.
const CHROME_RESERVE = 300
// Floor so very short screens still get a usable body.
const MIN_BODY_HEIGHT = 320

interface BottomSheetProps {
  title: string
  // Optional title accent (e.g. gold for "special" custom lines).
  titleColor?: string
  subtitle?: string
  // Wired to both the backdrop tap and the hardware back (onRequestClose).
  onClose: () => void
  // While true, dismissal is blocked (the `!saving` guard).
  busy?: boolean
  children: ReactNode
  // Button row rendered below the body, inside the sheet.
  footer?: ReactNode
  // Node pinned to the sheet's top-right corner, aligned with the title — for
  // a prominent at-a-glance value (e.g. the payout multiple on the line editor).
  headerRight?: ReactNode
  // Wrap in a KeyboardAvoidingView (iOS padding) — for sheets with text inputs.
  keyboardAvoiding?: boolean
}

// The canonical bottom-sheet scaffold: transparent slide Modal → overlay backdrop
// with a dismiss touchable → sheet → title/subtitle → body → footer. Renders
// <Toast /> inside the Modal unconditionally so toasts are never occluded by the
// native modal layer (context/toast.md). The component itself is always-visible —
// callers keep the conditional-mount contract (`{thing && <X …/>}`) so state
// resets between opens.
export default function BottomSheet({
  title,
  titleColor,
  subtitle,
  onClose,
  busy,
  children,
  footer,
  headerRight,
  keyboardAvoiding,
}: BottomSheetProps) {
  const { height } = useWindowDimensions()
  // The body grows with its content up to nearly the full screen height, then
  // scrolls. Applied universally so every sheet uses the available space before
  // scrolling — no caller needs to guess a pixel cap.
  const bodyMaxHeight = Math.max(MIN_BODY_HEIGHT, height - CHROME_RESERVE)

  function dismiss() {
    if (!busy) onClose()
  }

  const content = (
    <>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <View style={styles.sheet}>
        {headerRight != null && <View style={styles.headerRight}>{headerRight}</View>}
        <Text style={[styles.title, titleColor != null && { color: titleColor }]}>{title}</Text>
        {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
        <ScrollView style={{ maxHeight: bodyMaxHeight }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer}
      </View>
    </>
  )

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.backdrop}>{content}</View>
      )}
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  // Pinned to the sheet's top-right, aligned with the title's top edge (the
  // sheet's 24px padding is the inset).
  headerRight: { position: 'absolute', top: 24, right: 24, alignItems: 'flex-end' },
  title: { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5, marginTop: 2, marginBottom: 14 },
})
