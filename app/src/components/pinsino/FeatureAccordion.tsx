import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import ExplainerBody from './ExplainerBody'

interface FeatureAccordionProps {
  icon: string // emoji, matches the landing tile (🏟️ ⚔️ 🎯 🦈 📣 👀)
  title: string
  hook: string // one-line teaser shown on the collapsed bar
  bullets: string[] // plain-language points revealed on expand
  caveat?: string // optional gold/italic note (e.g. interest accrues)
  defaultCollapsed?: boolean
}

// A single collapsible "how it works" section for the Pinsino help screen.
// Mirrors the visual idiom of the betting LineRowContainer (surface bar +
// chevron, condensed title) but carries help copy rather than line rows.
// Owns its own collapse state so each section toggles independently.
export default function FeatureAccordion({
  icon,
  title,
  hook,
  bullets,
  caveat,
  defaultCollapsed = true,
}: FeatureAccordionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setCollapsed(c => !c)}
        activeOpacity={0.7}
      >
        <Text style={styles.icon}>{icon}</Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hook}>{hook}</Text>
        </View>
        <Text style={styles.chevron}>{collapsed ? '▸' : '▾'}</Text>
      </TouchableOpacity>
      {!collapsed && (
        <View style={styles.card}>
          <ExplainerBody bullets={bullets} caveat={caveat} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  icon: { fontSize: 26 },
  headerText: { flex: 1 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 17,
    letterSpacing: 0.3,
    color: colors.accent,
  },
  hook: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 1,
  },
  chevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    width: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
})
