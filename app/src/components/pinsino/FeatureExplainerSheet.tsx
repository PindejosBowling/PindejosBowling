import { View, Text, StyleSheet } from 'react-native'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ExplainerBody from './ExplainerBody'
import { colors, fonts } from '../../theme'
import type { FeatureExplainer } from '../../data/pinsinoExplainers'

interface FeatureExplainerSheetProps {
  // One feature's entry from EXPLAINERS. Mount conditionally
  // (`{helpOpen && <… />}`) per the BottomSheet contract.
  explainer: FeatureExplainer
  // Optional second explainer rendered as a labeled subsection below the
  // primary body (e.g. the Auction House "?" surfacing the Items catalog).
  subsection?: FeatureExplainer
  onClose: () => void
}

// The per-screen "?" sheet: the same explainer content as the central help
// screen (single source: data/pinsinoExplainers.ts), served in place.
export default function FeatureExplainerSheet({ explainer, subsection, onClose }: FeatureExplainerSheetProps) {
  return (
    <BottomSheet
      title={`${explainer.icon} ${explainer.title}`}
      subtitle={explainer.hook}
      onClose={onClose}
      footer={<Button label="Got it" variant="ghost" onPress={onClose} />}
    >
      <ExplainerBody bullets={explainer.bullets} caveat={explainer.caveat} />
      {subsection && (
        <View style={styles.subsection}>
          <Text style={styles.subsectionTitle}>
            {subsection.icon} {subsection.title}
          </Text>
          <ExplainerBody bullets={subsection.bullets} caveat={subsection.caveat} />
        </View>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  subsection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  subsectionTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    letterSpacing: 0.3,
    color: colors.accent,
    marginBottom: 8,
  },
})
