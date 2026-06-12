import { StyleSheet, View, useWindowDimensions } from 'react-native'
import PixelArt from './PixelArt'
import { SCENES, SceneName } from './scenes'

type Props = {
  scene: SceneName
}

/**
 * Ambient pixel-art backdrop. Mount as the first child inside a screen's
 * SafeAreaView so it sits behind the header + ScrollView; it never intercepts
 * touches and the screen keeps its own solid `colors.bg`.
 */
export default function PixelArtBackdrop({ scene }: Props) {
  const { width } = useWindowDimensions()
  const def = SCENES[scene]
  const cols = def.grid.rows.reduce((max, row) => Math.max(max, row.length), 0)
  const pixelSize = def.anchor === 'bottom' ? width / cols : (def.pixelSize ?? 6)

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles[def.anchor], { opacity: def.opacity }]}>
        <PixelArt grid={def.grid} pixelSize={pixelSize} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bottom: { position: 'absolute', bottom: 0, left: 0 },
  bottomCenter: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  bottomRight: { position: 'absolute', bottom: 0, right: 12 },
  topRight: { position: 'absolute', top: 120, right: 12 },
})
