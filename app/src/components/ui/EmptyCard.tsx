import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  text: string
  style?: StyleProp<ViewStyle>
}

// The canonical empty state: surface card + centered muted message. Use `style`
// for the caller's margins; visually different empty states keep their own styles.
export default function EmptyCard({ text, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },
})
