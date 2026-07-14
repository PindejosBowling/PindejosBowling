import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import type { TermsCopy } from '../../data/pinsinoExplainers'

interface TermsBlockProps {
  // Static rule lines from TERMS in data/pinsinoExplainers.ts. Callers append
  // any dynamic lines (e.g. a per-auction bounce fee) by composing locally.
  terms: TermsCopy
  heading?: string
  // Extra lines the caller composes with dynamic values, rendered after the
  // catalog lines and before the caution.
  extraLines?: string[]
}

// The standardized "rules of this action" body for confirm sheets: a section
// label, one plain-language rule per line, and an optional gold caution.
export default function TermsBlock({ terms, heading = 'THE TERMS', extraLines }: TermsBlockProps) {
  const lines = extraLines ? [...terms.lines, ...extraLines] : terms.lines
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{heading}</Text>
      {lines.map((line, idx) => (
        <View key={idx} style={styles.lineRow}>
          <Text style={styles.lineDot}>•</Text>
          <Text style={styles.lineText}>{line}</Text>
        </View>
      ))}
      {terms.caution ? <Text style={styles.caution}>{terms.caution}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  heading: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 8,
  },
  lineRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  lineDot: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.accent,
    lineHeight: 19,
  },
  lineText: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
  },
  caution: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.gold,
    marginTop: 4,
    lineHeight: 19,
  },
})
