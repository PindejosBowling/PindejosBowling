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
import { usePrefsStore } from '../stores/prefsStore'
import { useUiStore } from '../stores/uiStore'
import { timeAgo } from '../utils/helpers.js'
import { colors, fonts, radius } from '../theme'
import { supabase } from '../utils/supabase/client'
import type { Tables } from '../utils/supabase/database.types'

type Post = Tables<'board_posts'>

export default function TrashBoardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>()
  const { myName, setMyName } = usePrefsStore()
  const { showToast } = useUiStore()
  const [msg, setMsg] = useState('')
  const [posting, setPosting] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchPosts = useCallback(async () => {
    const { data } = await supabase
      .from('board_posts')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setPosts(data)
  }, [])

  useEffect(() => {
    fetchPosts().finally(() => setLoading(false))
  }, [fetchPosts])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchPosts()
    setRefreshing(false)
  }, [fetchPosts])

  async function post() {
    if (!myName.trim() || !msg.trim()) return
    setPosting(true)
    try {
      const { data: player } = await supabase
        .from('players')
        .select('id')
        .ilike('name', myName.trim())
        .single()

      if (!player) {
        showToast(`No player found named "${myName}"`, 'error')
        return
      }

      const { error } = await supabase
        .from('board_posts')
        .insert({ message: msg.trim(), player_id: player.id })

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
                <TextInput
                  style={styles.authorInput}
                  placeholder="Your name"
                  placeholderTextColor={colors.muted2}
                  value={myName}
                  onChangeText={setMyName}
                />
                <TextInput
                  style={styles.msgInput}
                  placeholder="Talk shit, hype the boys, whatever..."
                  placeholderTextColor={colors.muted2}
                  value={msg}
                  onChangeText={setMsg}
                  multiline
                  numberOfLines={3}
                />
                <TouchableOpacity
                  style={[styles.postBtn, (!myName.trim() || !msg.trim()) && styles.postBtnDisabled]}
                  onPress={post}
                  disabled={posting || !myName.trim() || !msg.trim()}
                  activeOpacity={0.7}
                >
                  <Text style={styles.postBtnText}>{posting ? 'Posting…' : 'Post'}</Text>
                </TouchableOpacity>
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
                <Text style={styles.postAuthor}>Bowler</Text>
                <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
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
  authorInput: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
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
  postBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  postBtnDisabled: {
    backgroundColor: colors.surface3,
  },
  postBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
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
