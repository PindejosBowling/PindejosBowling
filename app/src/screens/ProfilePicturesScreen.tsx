import { useState, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Toast from '../components/ui/Toast'
import PlayerAvatar from '../components/ui/PlayerAvatar'
import { usePlayerManagementData } from '../hooks/usePlayerManagementData'
import { useRefresh } from '../hooks/useRefresh'
import { useUiStore } from '../stores/uiStore'
import { useAvatarStore } from '../stores/avatarStore'
import { players, avatars } from '../utils/supabase/db'
import { Tables } from '../utils/supabase/database.types'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type Player = Tables<'players'>

export default function ProfilePicturesScreen() {
  const navigation = useNavigation<Nav>()
  const insets = useSafeAreaInsets()
  const showToast = useUiStore(s => s.showToast)
  const { loading, rawPlayers, reload } = usePlayerManagementData()
  const { refreshing, onRefresh } = useRefresh(reload)
  const reloadAvatars = useAvatarStore(s => s.load)

  // Track which player row is mid-upload/delete so we can show a spinner.
  const [busyId, setBusyId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...rawPlayers].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [rawPlayers],
  )

  async function uploadFor(player: Player) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      showToast('Photo library permission denied', 'error')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    })
    if (result.canceled || !result.assets[0]) return

    setBusyId(player.id)
    try {
      // Downscale + compress before upload (keeps files tiny; avoids Pro-tier transforms).
      const manipulated = await manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      )
      if (!manipulated.base64) {
        showToast('Could not read image', 'error')
        return
      }

      const path = `${player.id}.jpg`
      const { error: upErr } = await avatars.upload(path, decode(manipulated.base64), 'image/jpeg')
      if (upErr) { showToast(upErr.message, 'error'); return }

      const { error: dbErr } = await players.update(player.id, { avatar_path: path })
      if (dbErr) { showToast(dbErr.message, 'error'); return }

      showToast(`Updated ${player.name}'s photo`, 'success')
      await Promise.all([reload(), reloadAvatars()])
    } catch (e: any) {
      showToast(e?.message ?? 'Upload failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteFor(player: Player) {
    if (!player.avatar_path) return
    setBusyId(player.id)
    try {
      const { error: rmErr } = await avatars.remove(player.avatar_path)
      if (rmErr) { showToast(rmErr.message, 'error'); return }

      const { error: dbErr } = await players.update(player.id, { avatar_path: null })
      if (dbErr) { showToast(dbErr.message, 'error'); return }

      showToast(`Removed ${player.name}'s photo`, 'success')
      await Promise.all([reload(), reloadAvatars()])
    } catch (e: any) {
      showToast(e?.message ?? 'Delete failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Profile Pictures"
        subtitle="Manage player profile photos"
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <LoadingView label="Loading players…" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        >
          <Text style={styles.sectionHeader}>PLAYERS ({sorted.length})</Text>
          {sorted.map(p => {
            const busy = busyId === p.id
            const hasPhoto = !!p.avatar_path
            return (
              <View key={p.id} style={styles.row}>
                <PlayerAvatar name={p.name} playerId={p.id} size={44} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub}>{hasPhoto ? 'Has photo' : 'No photo'}</Text>
                </View>

                {busy ? (
                  <ActivityIndicator color={colors.accent} style={styles.busy} />
                ) : (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => uploadFor(p)} activeOpacity={0.8}>
                      <Text style={styles.actionText}>{hasPhoto ? 'Replace' : 'Upload'}</Text>
                    </TouchableOpacity>
                    {hasPhoto && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn]}
                        onPress={() => deleteFor(p)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )
          })}
          {sorted.length === 0 && <Text style={styles.emptyText}>No players</Text>}
        </ScrollView>
      )}

      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 8 },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12,
  },
  rowInfo: { flex: 1 },
  rowName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 17,
    color: colors.text,
    letterSpacing: 0.3,
  },
  rowSub: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },

  actions: { flexDirection: 'row', gap: 8 },
  busy: { paddingHorizontal: 12 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  actionText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.5,
  },
  deleteBtn: { borderColor: colors.danger },
  deleteText: { color: colors.danger },
})
