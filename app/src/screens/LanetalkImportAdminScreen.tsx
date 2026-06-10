import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import Dropdown from '../components/Dropdown'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useLanetalkImportAdmin } from '../hooks/useLanetalkImportAdmin'
import { lanetalkImports, type LanetalkImportSummary } from '../utils/supabase/db'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

type Classification = 'official' | 'recreational'

const CLASSIFICATION_OPTIONS: { key: Classification; label: string; color: string; tint: string }[] = [
  { key: 'official', label: 'Official', color: colors.success, tint: 'rgba(74,222,128,0.15)' },
  { key: 'recreational', label: 'Recreational', color: colors.muted, tint: 'rgba(122,122,133,0.15)' },
]

interface GroupGame {
  id: string
  gameNumber: number
  score: number | null
  classification: Classification
  playedAt: string | null
}
interface ImportGroup {
  key: string
  sourceUrl: string
  playerName: string | null
  createdAt: string
  games: GroupGame[]
}

export default function LanetalkImportAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const showToast = useUiStore(s => s.showToast)
  const { loading, rawImports, reload } = useLanetalkImportAdmin()
  const { refreshing, onRefresh } = useRefresh(reload)

  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LanetalkImportSummary | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  // Optimistic per-game classification edits, keyed by row id, plus the set of
  // rows currently being saved (to disable their toggle while in flight).
  const [classEdits, setClassEdits] = useState<Record<string, Classification>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())

  const groups = useMemo<ImportGroup[]>(() => {
    // Group rows that share the same week_id AND player_id into one player's set
    // of records. Rows without a matched player (player_id null) can't be merged
    // by player, so they fall back to grouping by source_url.
    const map = new Map<string, ImportGroup>()
    for (const r of rawImports) {
      const key = r.player_id && r.week_id
        ? `${r.week_id}::${r.player_id}`
        : `url::${r.source_url}`
      let g = map.get(key)
      if (!g) {
        g = { key, sourceUrl: r.source_url, playerName: r.players?.name ?? null, createdAt: r.created_at, games: [] }
        map.set(key, g)
      }
      g.games.push({
        id: r.id,
        gameNumber: r.game_number,
        score: r.score,
        classification: r.classification,
        playedAt: r.played_at ?? null,
      })
    }
    const out = [...map.values()]
    // Sort each group's games first-to-last by played_at (nulls last, then game number).
    out.forEach(g => g.games.sort((a, b) => {
      if (a.playedAt && b.playedAt) return a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : a.gameNumber - b.gameNumber
      if (a.playedAt) return -1
      if (b.playedAt) return 1
      return a.gameNumber - b.gameNumber
    }))
    return out
  }, [rawImports])

  async function runImport() {
    const link = url.trim()
    if (!link) { showToast('Paste a Lanetalk link', 'error'); return }
    setBusy(true)
    setResult(null)
    setShowDebug(false)
    try {
      const data = await lanetalkImports.run(link)
      setResult(data)
      if (!data.ok) { showToast(data.message ?? 'Import failed', 'error'); return }
      const who = data.matchedPlayer ? `for ${data.matchedPlayer}` : '(no player match)'
      showToast(`Imported ${data.games?.length ?? 0} games ${who} · ${data.officialCount ?? 0} official`, 'success')
      setUrl('')
      await reload()
    } catch (e: any) {
      const data: LanetalkImportSummary = { ok: false, stage: 'client', message: e?.message ?? 'Import failed' }
      setResult(data)
      showToast(data.message ?? 'Import failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function changeClassification(game: GroupGame, next: Classification) {
    if (next === (classEdits[game.id] ?? game.classification)) return
    if (savingIds.has(game.id)) return
    const prev = classEdits[game.id] ?? game.classification
    setClassEdits(m => ({ ...m, [game.id]: next }))
    setSavingIds(s => new Set(s).add(game.id))
    try {
      const { error } = await lanetalkImports.setClassification(game.id, next)
      if (error) throw error
      showToast(`Game ${game.gameNumber} marked ${next === 'official' ? 'Official' : 'Recreational'}`, 'success')
    } catch (e: any) {
      setClassEdits(m => ({ ...m, [game.id]: prev }))
      showToast(e?.message ?? 'Could not update classification', 'error')
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(game.id); return n })
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lanetalk Import" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.emptyText}>Admins only</Text></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lanetalk Import" subtitle="Pull a shared-session link into the league" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <View style={styles.card}>
          <Text style={styles.label}>Lanetalk share link</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://shared.lanetalk.com/…"
            placeholderTextColor={colors.muted2}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
          />
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={runImport}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={styles.buttonText}>Fetch & Import</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>
            Games matching the bowler's recorded league scores are marked Official; the rest Recreational.
          </Text>
        </View>

        {result && !result.ok && (
          <View style={[styles.resultCard, styles.resultError]}>
            <View style={styles.resultHeaderRow}>
              <Text style={styles.resultTitle}>Import failed</Text>
              {!!result.stage && (
                <View style={styles.stageBadge}><Text style={styles.stageBadgeText}>{result.stage}</Text></View>
              )}
            </View>
            <Text style={styles.resultMessage}>{result.message ?? 'Unknown error'}</Text>
            {!!result.reqId && <Text style={styles.resultReqId}>reqId: {result.reqId}</Text>}
            {!!result.debug && Object.keys(result.debug).length > 0 && (
              <>
                <TouchableOpacity onPress={() => setShowDebug(v => !v)} style={styles.debugToggle}>
                  <Text style={styles.debugToggleText}>{showDebug ? '▾ Hide details' : '▸ Show details'}</Text>
                </TouchableOpacity>
                {showDebug && (
                  <Text style={styles.debugJson} selectable>{JSON.stringify(result.debug, null, 2)}</Text>
                )}
              </>
            )}
          </View>
        )}

        <Text style={styles.sectionHeader}>RECENT IMPORTS</Text>
        {groups.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>No imports yet.</Text></View>
        ) : (
          groups.map(g => (
            <View key={g.key} style={styles.groupCard}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupPlayer}>{g.playerName ?? 'No player match'}</Text>
                <Text style={styles.groupUrl} numberOfLines={1}>{g.sourceUrl}</Text>
              </View>
              {g.games.map((game) => (
                <View key={game.id} style={styles.gameRow}>
                  <Text style={styles.gameLabel}>Game {game.gameNumber}</Text>
                  <Text style={styles.gameScore}>{game.score ?? '—'}</Text>
                  <Dropdown
                    options={CLASSIFICATION_OPTIONS}
                    value={classEdits[game.id] ?? game.classification}
                    onChange={(key) => changeClassification(game, key)}
                    disabled={savingIds.has(game.id)}
                  />
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 12,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.bg, letterSpacing: 0.4, fontWeight: '600' },
  hint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 17 },
  resultCard: {
    borderRadius: radius.cardMd,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
  },
  resultError: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.45)' },
  resultHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultTitle: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.danger, letterSpacing: 0.3 },
  stageBadge: { backgroundColor: 'rgba(239,68,68,0.18)', borderRadius: radius.cardSm, paddingHorizontal: 8, paddingVertical: 3 },
  stageBadgeText: { fontFamily: monoFont, fontSize: 11, color: colors.danger, letterSpacing: 0.3 },
  resultMessage: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, marginTop: 8, lineHeight: 19 },
  resultReqId: { fontFamily: monoFont, fontSize: 11, color: colors.muted, marginTop: 8 },
  debugToggle: { marginTop: 10 },
  debugToggleText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3 },
  debugJson: {
    fontFamily: monoFont,
    fontSize: 11,
    color: colors.muted,
    marginTop: 8,
    padding: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    lineHeight: 16,
  },
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  groupHeader: { marginBottom: 8 },
  groupPlayer: { fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3 },
  groupUrl: { fontFamily: fonts.barlow, fontSize: 11, color: colors.muted2, marginTop: 2 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  gameLabel: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, flex: 1 },
  gameScore: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.text, width: 48, textAlign: 'right', marginRight: 12 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3 },
})
