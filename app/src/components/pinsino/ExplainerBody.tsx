import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'

interface ExplainerBodyProps {
  bullets: string[]
  caveat?: string
}

// The bullets + gold caveat interior shared by every explainer surface: the
// help-screen FeatureAccordion cards and the per-screen FeatureExplainerSheet.
// Copy comes from data/pinsinoExplainers.ts — never inline.
export default function ExplainerBody({ bullets, caveat }: ExplainerBodyProps) {
  return (
    <View>
      {bullets.map((b, idx) => (
        <View key={idx} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{b}</Text>
        </View>
      ))}
      {caveat ? <Text style={styles.caveat}>{caveat}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  bulletDot: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.accent,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  caveat: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.gold,
    marginTop: 2,
  },
})
