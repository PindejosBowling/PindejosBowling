import { useState } from 'react'
import {
  Modal, View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, radius } from '../theme'
import { initials } from '../utils/helpers'

interface Props {
  visible: boolean
  players: string[]
  onSelect: (name: string) => void
  onClose: () => void
  title?: string
}

export default function PlayerPickerModal({ visible, players, onSelect, onClose, title = 'Select Player' }: Props) {
  const [search, setSearch] = useState('')

  const filtered = players.filter((name) =>
    name.toLowerCase().includes(search.toLowerCase())
  )

  function handleSelect(name: string) {
    setSearch('')
    onSelect(name)
  }

  function handleClose() {
    setSearch('')
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.search}
            placeholder="Search…"
            placeholderTextColor={colors.muted2}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.playerRow}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(item)}</Text>
                </View>
                <Text style={styles.playerName}>{item}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No players found.</Text>
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
    letterSpacing: 0.5,
  },
  closeBtn: { padding: 6 },
  closeText: { color: colors.muted, fontSize: 16 },

  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted },
  playerName: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    padding: 24,
  },
})
