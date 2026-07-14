import { ReactNode } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, KeyboardAvoidingView,
  type ScrollViewProps,
} from 'react-native'
import { colors, fonts, radius } from '../../theme'
import Toast from './Toast'

interface CenterModalProps {
  // Header title (with an optional accent color). Omit for a chromeless card.
  title?: string
  titleColor?: string
  subtitle?: string
  // Wired to the backdrop tap, the ✕ button, and hardware back (onRequestClose).
  onClose: () => void
  // While true, dismissal is blocked (mirrors BottomSheet's `!saving` guard).
  busy?: boolean
  children: ReactNode
  // Button row rendered below the body, pinned inside the card.
  footer?: ReactNode
  // Wrap in a KeyboardAvoidingView (iOS padding) — for cards with text inputs.
  keyboardAvoiding?: boolean
  // Show the header ✕ (default true when a header renders). Set false for
  // confirm dialogs that dismiss only via their footer buttons / backdrop.
  showClose?: boolean
  // Card shell color. 'bg' (darker) is for layouts whose body stacks its own
  // `surface` cards and needs them to contrast against the shell (e.g. PvP).
  background?: 'surface' | 'bg'
  // Horizontal padding on the scrolling body (default true). Pass false when the
  // body brings its own horizontal padding / full-bleed layout.
  contentPadded?: boolean
  // Passed through to the body ScrollView (e.g. pull-to-refresh on a detail card).
  refreshControl?: ScrollViewProps['refreshControl']
}

// The canonical centered-card popup: transparent fade Modal → overlay backdrop
// with a dismiss touchable → centered card → pinned header (title + ✕) → a
// scrolling body → pinned footer. The card grows with its content up to 85% of
// the screen, then the body scrolls (header/footer stay put) — so a tall detail
// or a form under a raised keyboard never overflows. Renders <Toast /> inside
// the Modal unconditionally so toasts are never occluded by the native modal
// layer (context/toast.md). Always-visible — callers keep the conditional-mount
// contract (`{thing && <X …/>}`) so state resets between opens. The centered
// counterpart to BottomSheet; share its contracts.
export default function CenterModal({
  title,
  titleColor,
  subtitle,
  onClose,
  busy,
  children,
  footer,
  keyboardAvoiding,
  showClose = true,
  background = 'surface',
  contentPadded = true,
  refreshControl,
}: CenterModalProps) {
  function dismiss() {
    if (!busy) onClose()
  }

  const hasHeader = title != null || showClose

  const content = (
    <>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <View style={[styles.card, background === 'bg' && styles.cardBg]}>
        {hasHeader && (
          <View style={styles.headerWrap}>
            <View style={styles.headerRow}>
              {title != null ? (
                <Text style={[styles.title, titleColor != null && { color: titleColor }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : (
                <View style={styles.flex1} />
              )}
              {showClose && (
                <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        )}
        <ScrollView
          style={styles.body}
          contentContainerStyle={{
            paddingHorizontal: contentPadded ? 24 : 0,
            paddingTop: hasHeader ? 0 : 24,
            paddingBottom: footer ? 4 : 24,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
        {footer != null && <View style={styles.footerWrap}>{footer}</View>}
      </View>
    </>
  )

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
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
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    // Cap so tall content (many rows / a long form) can't overflow the screen —
    // the body scrolls past this point while header + footer stay pinned.
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardBg: { backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flex1: { flex: 1 },
  title: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginRight: 12,
  },
  close: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted,
  },
  subtitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  // flexShrink lets the body fall below its content height so the card honors
  // maxHeight and the rows scroll instead of overflowing.
  body: { flexShrink: 1 },
  footerWrap: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
})
