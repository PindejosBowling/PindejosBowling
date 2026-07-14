import { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'

interface ScreenHeaderProps {
  title: string
  subtitle?: string
  onBack: () => void
  // Optional element pinned to the top-right (e.g. the ArtworkToggle on screens
  // with a pixel-art backdrop).
  right?: ReactNode
  // Optional "?" button (the AppHeader help idiom) rendered before `right` —
  // feature screens use it to open their FeatureExplainerSheet. Kept separate
  // from `right` so it survives on backdrop screens where `right` is the
  // ArtworkToggle.
  onHelp?: () => void
}

export default function ScreenHeader({ title, subtitle, onBack, right, onHelp }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>
      <View style={styles.titleWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {onHelp && (
        <TouchableOpacity onPress={onHelp} activeOpacity={0.7} style={styles.helpBtn} accessibilityLabel="How it works">
          <Text style={styles.helpIcon}>?</Text>
        </TouchableOpacity>
      )}
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  titleWrap: { flex: 1 },
  right: { marginLeft: 12 },
  helpBtn: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpIcon: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    color: colors.accent,
    lineHeight: 22,
  },
  backBtn: { marginRight: 12, padding: 4 },
  backText: { fontSize: 20, color: colors.text },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 1,
  },
})
