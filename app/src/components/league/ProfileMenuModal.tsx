import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useAuthStore } from '../../stores/authStore'
import { colors, fonts, radius } from '../../theme'
import { initials } from '../../utils/helpers'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function ProfileMenuModal({ visible, onClose }: Props) {
  const navigation = useNavigation()
  const playerName = useAuthStore(s => s.playerName)
  const signOut = useAuthStore(s => s.signOut)

  function handleViewProfile() {
    if (!playerName) return
    onClose()
    ;(navigation as any).navigate('Standings', {
      screen: 'PlayerDetail',
      params: { name: playerName },
    })
  }

  async function handleLogout() {
    onClose()
    await signOut()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />

          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {playerName ? initials(playerName) : '?'}
              </Text>
            </View>
            <Text style={styles.name}>{playerName ?? 'Player'}</Text>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={handleViewProfile} activeOpacity={0.7}>
            <Text style={styles.rowIcon}>📊</Text>
            <Text style={styles.rowLabel}>My Profile</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={handleLogout} activeOpacity={0.7}>
            <Text style={styles.rowIcon}>🚪</Text>
            <Text style={styles.rowLabelDanger}>Log Out</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  identity: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accentDim,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 28,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  name: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowIcon: {
    fontSize: 18,
    marginRight: 14,
  },
  rowLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.5,
    flex: 1,
  },
  rowLabelDanger: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.danger,
    letterSpacing: 0.5,
    flex: 1,
  },
})
