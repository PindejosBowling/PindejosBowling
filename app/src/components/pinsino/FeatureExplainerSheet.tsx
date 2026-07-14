import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ExplainerBody from './ExplainerBody'
import type { FeatureExplainer } from '../../data/pinsinoExplainers'

interface FeatureExplainerSheetProps {
  // One feature's entry from EXPLAINERS. Mount conditionally
  // (`{helpOpen && <… />}`) per the BottomSheet contract.
  explainer: FeatureExplainer
  onClose: () => void
}

// The per-screen "?" sheet: the same explainer content as the central help
// screen (single source: data/pinsinoExplainers.ts), served in place.
export default function FeatureExplainerSheet({ explainer, onClose }: FeatureExplainerSheetProps) {
  return (
    <BottomSheet
      title={`${explainer.icon} ${explainer.title}`}
      subtitle={explainer.hook}
      onClose={onClose}
      bodyMaxHeight={420}
      footer={<Button label="Got it" variant="ghost" onPress={onClose} />}
    >
      <ExplainerBody bullets={explainer.bullets} caveat={explainer.caveat} />
    </BottomSheet>
  )
}
