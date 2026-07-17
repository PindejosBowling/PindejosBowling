import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native'
import { colors, fonts, radius } from '../theme'

// Full-screen block shown by the update gate (useUpdateGate) when this
// binary's version is below app_version_config.min_supported_version.
// Rendered INSTEAD of Login/RootNavigator — a build this old can no longer
// receive OTA updates, so every screen behind it would be stale.
export default function UpdateRequiredScreen({ message }: { message: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🎳</Text>
      <Text style={styles.title}>UPDATE REQUIRED</Text>
      <Text style={styles.message}>
        {message || 'A new version of the app is required. Update on TestFlight to keep playing.'}
      </Text>
      <TouchableOpacity
        style={styles.btn}
        // itms-beta:// opens the TestFlight app directly; if it's missing the
        // App Store listing is the fallback.
        onPress={() => Linking.openURL('itms-beta://').catch(() => {
          Linking.openURL('https://apps.apple.com/app/testflight/id899247664').catch(() => {})
        })}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>Open TestFlight</Text>
      </TouchableOpacity>
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
  btn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
  },
  btnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: '#0a0a0c',
    letterSpacing: 0.5,
  },
})
