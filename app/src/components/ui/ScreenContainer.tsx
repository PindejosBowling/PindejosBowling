import { ReactNode } from 'react'
import { ScrollView, RefreshControl, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { colors } from '../../theme'
import ScreenHeader from './ScreenHeader'
import ArtworkToggle from './ArtworkToggle'
import LoadingView from './LoadingView'
import { useRefresh } from '../../hooks/useRefresh'
import { useUiStore } from '../../stores/uiStore'

interface ScreenContainerProps {
  title: string
  subtitle?: string
  // Defaults to navigation.goBack().
  onBack?: () => void
  // Pinned top-right in the header. Ignored when `backdrop` is set — backdrop
  // screens always get the <ArtworkToggle /> there instead.
  headerRight?: ReactNode
  // Fixed pixel-art scene mounted as the first child inside the SafeAreaView
  // (behind header + content). Providing it also wires the ArtworkToggle and
  // hides the scrollable content while uiStore.artworkReveal is on. Scroll-length
  // fields (Sportsbook) don't fit this shell — see pixelart/config.ts.
  backdrop?: ReactNode
  // Standard loading state: plain <LoadingView /> normally; with a backdrop the
  // scene paints immediately and the spinner is transparent + delayed.
  loading?: boolean
  loadingLabel?: string
  // Enables pull-to-refresh; the container owns the useRefresh spinner state.
  onRefresh?: () => Promise<void>
  // Set false for screens that scroll themselves (e.g. FlatList) — children
  // mount directly under the header with no ScrollView or refresh control.
  scroll?: boolean
  // Fixed between the header and the scroll area (filter pills, view toggles) —
  // stays pinned while the content scrolls. Hidden with the content on artwork reveal.
  pinned?: ReactNode
  // Mounted last, as a sibling OUTSIDE the scroll area — for absolutely-positioned
  // elements that must not live inside a ScrollView (<Toast />, sticky ConfirmBar).
  overlay?: ReactNode
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled'
  // Merged over the default { paddingHorizontal: 16, paddingBottom: 40 }.
  contentStyle?: StyleProp<ViewStyle>
  children?: ReactNode
}

// The inner-stack screen scaffold: SafeAreaView + ScreenHeader + pull-to-refresh
// ScrollView, plus the optional pixel-art backdrop wiring. New screens should
// start here instead of hand-rolling the shell.
export default function ScreenContainer({
  title,
  subtitle,
  onBack,
  headerRight,
  backdrop,
  loading = false,
  loadingLabel = 'Loading…',
  onRefresh,
  scroll = true,
  pinned,
  overlay,
  keyboardShouldPersistTaps,
  contentStyle,
  children,
}: ScreenContainerProps) {
  const navigation = useNavigation()
  const artworkReveal = useUiStore(s => s.artworkReveal)
  const { refreshing, onRefresh: handleRefresh } = useRefresh(onRefresh ?? (async () => {}))

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {backdrop}
        <LoadingView label={loadingLabel} transparent={!!backdrop} delayed={!!backdrop} />
      </SafeAreaView>
    )
  }

  const contentHidden = !!backdrop && artworkReveal

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {backdrop}
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={onBack ?? (() => navigation.goBack())}
        right={backdrop ? <ArtworkToggle /> : headerRight}
      />
      {!contentHidden && pinned}
      {!contentHidden &&
        (scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.muted} />
              ) : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          children
        ))}
      {overlay}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
})
