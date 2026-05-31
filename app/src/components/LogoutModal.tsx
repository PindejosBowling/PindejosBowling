import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { colors, fonts, radius } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function LogoutModal({ visible, onClose }: Props) {
  const setRole = useAuthStore(s => s.setRole)

  async function confirm() {
    onClose()
    await setRole(null)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Log Out?</Text>
          <Text style={styles.subtitle}>
            You'll be returned to the login screen.
          </Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnDanger} onPress={confirm} activeOpacity={0.7}>
              <Text style={styles.btnDangerText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  btnCancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  btnDanger: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  btnDangerText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
})
