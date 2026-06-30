import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  // The concluded season's number being reviewed.
  seasonNumber: number | null
}

// Shown atop every Pinsino sub-surface when a PRIOR season is selected, marking
// the whole view as a frozen end-of-season archive (no new action). Mirrors the
// `finalBanner` styling on the Pinsino landing for one consistent affordance.
export default function ReadOnlySeasonBanner({ seasonNumber }: Props) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        VIEWING SEASON {seasonNumber ?? '—'} · READ ONLY
      </Text>
      <Text style={styles.sub}>All outcomes are final — no new action.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 12,
  },
  text: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    letterSpacing: 2,
    color: colors.accent,
  },
  sub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 2,
  },
})
