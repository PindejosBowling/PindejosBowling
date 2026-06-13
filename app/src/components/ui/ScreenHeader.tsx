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
}

export default function ScreenHeader({ title, subtitle, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>
      <View style={styles.titleWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
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
