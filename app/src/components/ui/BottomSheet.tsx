import { ReactNode } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, KeyboardAvoidingView,
} from 'react-native'
import { colors, fonts } from '../../theme'
import Toast from './Toast'

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
  // Wrap in a KeyboardAvoidingView (iOS padding) — for sheets with text inputs.
  keyboardAvoiding?: boolean
  // When set, the body is wrapped in a ScrollView capped at this height.
  bodyMaxHeight?: number
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
  keyboardAvoiding,
  bodyMaxHeight,
}: BottomSheetProps) {
  function dismiss() {
    if (!busy) onClose()
  }

  const content = (
    <>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <View style={styles.sheet}>
        <Text style={[styles.title, titleColor != null && { color: titleColor }]}>{title}</Text>
        {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
        {bodyMaxHeight != null ? (
          <ScrollView style={{ maxHeight: bodyMaxHeight }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          children
        )}
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
  title: { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5, marginTop: 2, marginBottom: 14 },
})
