import React, { useState } from 'react'
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
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'
import { useDataStore } from '../stores/dataStore'
import { usePrefsStore } from '../stores/prefsStore'
import { isChampion } from '../utils/data.js'
import { timeAgo } from '../utils/helpers.js'
import { apiPost } from '../api.js'
import { colors, fonts, radius } from '../theme'

export default function TrashBoardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>()
  const { loading, board, champions, loadAll } = useDataStore()
  const { myName, setMyName } = usePrefsStore()
  const [msg, setMsg] = useState('')
  const [posting, setPosting] = useState(false)
  const { refreshing, onRefresh } = useRefresh(loadAll)

  const posts = (board ?? []).slice(1).filter((p: any[]) => p[2]).slice().reverse() as any[][]

  async function post() {
    if (!myName.trim() || !msg.trim()) return
    setPosting(true)
    try {
      await apiPost('postToBoard', { author: myName, message: msg })
      await loadAll()
      setMsg('')
    } finally {
      setPosting(false)
    }
  }

  if (loading && !board) {
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
          keyExtractor={(_, i) => String(i)}
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
                <Text style={styles.postAuthor}>
                  {item[1] || 'Anon'}
                  {isChampion(champions, item[1]) ? ' 👑' : ''}
                </Text>
                <Text style={styles.postTime}>{timeAgo(item[0])}</Text>
              </View>
              <Text style={styles.postMsg}>{item[2]}</Text>
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
