import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'
import Button from '../components/Button'
import { useUiStore } from '../stores/uiStore'
import { timeAgo } from '../utils/helpers'
import { colors, fonts, radius } from '../theme'
import { boardPosts } from '../utils/supabase/db'
import { useAuthStore } from '../stores/authStore'
import type { Tables } from '../utils/supabase/database.types'

type Post = Tables<'board_posts'> & {
  players: Pick<Tables<'players'>, 'name'> | null
}

export default function TrashBoardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>()
  const { showToast } = useUiStore()
  const { playerId, playerName } = useAuthStore()
  const [msg, setMsg] = useState('')
  const [posting, setPosting] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchPosts = useCallback(async () => {
    const { data } = await boardPosts.list()
    if (data) setPosts(data as Post[])
  }, [])

  useEffect(() => {
    fetchPosts().finally(() => setLoading(false))
  }, [fetchPosts])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchPosts()
    setRefreshing(false)
  }, [fetchPosts])

  async function deletePost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
    const { error } = await boardPosts.remove(id)
    if (error) {
      showToast('Failed to delete post', 'error')
      await fetchPosts()
    }
  }

  async function post() {
    if (!playerId || !msg.trim()) return
    setPosting(true)
    try {
      const { error } = await boardPosts.insert({ message: msg.trim(), player_id: playerId })
      if (error) {
        showToast('Failed to post', 'error')
      } else {
        await fetchPosts()
        setMsg('')
      }
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader />
        <LoadingView label="Loading board" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            <>
              <ScreenHeader title="Trash Board" onBack={() => navigation.goBack()} />

              <View style={styles.composer}>
                <Text style={styles.composerAuthor}>{playerName}</Text>
                <TextInput
                  style={styles.msgInput}
                  placeholder="Talk shit, hype the boys, whatever..."
                  placeholderTextColor={colors.muted2}
                  value={msg}
                  onChangeText={setMsg}
                  multiline
                  numberOfLines={3}
                />
                <Button label="Post" onPress={post} loading={posting} disabled={posting || !msg.trim()} style={styles.postBtn} />
              </View>

              {posts.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>Be the first to talk some shit.</Text>
                </View>
              )}
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.postCard}>
              <View style={styles.postHead}>
                <View style={styles.postMeta}>
                  <Text style={styles.postAuthor}>{item.players?.name ?? 'Unknown'}</Text>
                  <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
                </View>
                {item.player_id === playerId && (
                  <TouchableOpacity onPress={() => deletePost(item.id)} hitSlop={8}>
                    <Text style={styles.deleteBtn}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.postMsg}>{item.message}</Text>
            </View>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  composer: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  composerAuthor: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.5,
  },
  msgInput: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  postBtn: { paddingVertical: 10 },
  emptyState: {
    alignItems: 'center',
    paddingTop: 32,
  },
  emptyText: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.muted,
  },
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  postHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  postMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteBtn: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
  },
  postAuthor: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
  },
  postTime: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
  },
  postMsg: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
})
