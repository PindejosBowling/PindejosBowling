import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, fonts } from '../theme'

// Full-screen hold shown by useOtaUpdates while a freshly published OTA
// bundle downloads and the app restarts (fetchUpdateAsync → reloadAsync).
// Rendered INSTEAD of Login/RootNavigator so the reload can't interrupt
// mid-interaction; typically visible for only a few seconds.
export default function OtaUpdatingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🎳</Text>
      <Text style={styles.title}>FRESH OIL PATTERN</Text>
      <Text style={styles.message}>
        Grabbing the latest version of the app — it'll restart itself in a
        moment.
      </Text>
      <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emoji: { fontSize: 48 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 28,
    letterSpacing: 2,
    color: colors.text,
  },
  message: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  spinner: { marginTop: 12 },
})
