import { useMemo, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Toast from '../components/ui/Toast'
import Dropdown from '../components/ui/Dropdown'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useLanetalkImportAdmin } from '../hooks/useLanetalkImportAdmin'
import { lanetalkImports, type LanetalkImportSummary } from '../utils/supabase/db'
import EmptyCard from '../components/ui/EmptyCard'
import LanetalkConfirmModal from '../components/admin/LanetalkConfirmModal'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

type Classification = 'official' | 'recreational'

const CLASSIFICATION_OPTIONS: { key: Classification; label: string; color: string; tint: string }[] = [
  { key: 'official', label: 'Official', color: colors.success, tint: 'rgba(74,222,128,0.15)' },
  { key: 'recreational', label: 'Recreational', color: colors.muted, tint: 'rgba(122,122,133,0.15)' },
]

interface GroupGame {
  // game_number is resolved by the importer: official games take their league
  // game number, recreational games are numbered sequentially after them.
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
interface WeekGroup {
  weekKey: string
  weekNumber: number | null
  bowledAt: string | null
  players: ImportGroup[]
}
interface LinkResult {
  url: string
  summary: LanetalkImportSummary
}

function formatDate(bowledAt: string | null): string {
  if (!bowledAt) return ''
  const [year, month, day] = bowledAt.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LanetalkImportAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const showToast = useUiStore(s => s.showToast)
  const { loading, rawImports, unsettledProps, settledPropWeeks, reload } = useLanetalkImportAdmin()
  const { refreshing, onRefresh } = useRefresh(reload)

  // Unsettled LaneTalk stat props, grouped by week — each week group with any
  // pending props gets a "Confirm LaneTalk Data" action. The button hides once
  // nothing is unsettled (the list reloads after each confirm).
  const propsByWeek = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const m of unsettledProps) {
      if (!m.week_id) continue
      const arr = map.get(m.week_id)
      if (arr) arr.push(m)
      else map.set(m.week_id, [m])
    }
    return map
  }, [unsettledProps])
  const [confirmWeek, setConfirmWeek] = useState<{ weekId: string; title: string } | null>(null)

  // One or more links to import in a batch. Start with a single empty row; the
  // "+" button appends another. Links are processed sequentially (the importer
  // combines a player's links across calls, so order-independent and safe).
  const [links, setLinks] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  // Per-link outcomes from the last batch run, in submit order.
  const [results, setResults] = useState<LinkResult[]>([])
  const [showDebug, setShowDebug] = useState<Set<number>>(new Set())
  // Optimistic per-game classification edits, keyed by row id, plus the set of
  // rows currently being saved (to disable their toggle while in flight).
  const [classEdits, setClassEdits] = useState<Record<string, Classification>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  // Week currently being reprocessed (re-matched from stored data), if any.
  const [reprocessingWeek, setReprocessingWeek] = useState<string | null>(null)

  const weekGroups = useMemo<WeekGroup[]>(() => {
    // Two-level grouping: by the league week each import resolved to, then within
    // a week by player. Rows that share week_id AND player_id collapse into one
    // player set; rows without a matched player (player_id null) fall back to
    // grouping by source_url. Imports whose week was deleted (week_id null) bucket
    // under a single "no week" group.
    const playerMap = new Map<string, ImportGroup>()
    const weeks = new Map<string, WeekGroup>()
    for (const r of rawImports) {
      const weekKey = r.week_id ?? 'unassigned'
      let wg = weeks.get(weekKey)
      if (!wg) {
        wg = { weekKey, weekNumber: r.weeks?.week_number ?? null, bowledAt: r.weeks?.bowled_at ?? null, players: [] }
        weeks.set(weekKey, wg)
      }
      const key = r.player_id && r.week_id
        ? `${r.week_id}::${r.player_id}`
        : `url::${r.source_url}`
      let g = playerMap.get(key)
      if (!g) {
        g = { key, sourceUrl: r.source_url, playerName: r.players?.name ?? null, createdAt: r.created_at, games: [] }
        playerMap.set(key, g)
        wg.players.push(g)
      }
      g.games.push({
        id: r.id,
        gameNumber: r.game_number,
        score: r.score,
        classification: r.classification,
        playedAt: r.played_at ?? null,
      })
    }
    // Order each player group's games by their resolved game number (official games
    // 1..K first, then recreational games numbered after them).
    for (const g of playerMap.values()) {
      g.games.sort((a, b) => a.gameNumber - b.gameNumber)
    }
    // Newest week first; the "no week" bucket sinks to the bottom.
    const out = [...weeks.values()]
    out.sort((a, b) => {
      if (a.weekNumber == null) return 1
      if (b.weekNumber == null) return -1
      return b.weekNumber - a.weekNumber
    })
    return out
  }, [rawImports])

  // The most-recent week (the one we're importing into) defaults to expanded so
  // it's ready to review on load; older weeks default collapsed. `toggledWeeks`
  // holds only the weeks the admin has flipped away from that default.
  const [toggledWeeks, setToggledWeeks] = useState<Set<string>>(new Set())
  const mostRecentWeekKey = weekGroups[0]?.weekKey ?? null
  const isWeekExpanded = useCallback((weekKey: string) => {
    const defaultExpanded = weekKey === mostRecentWeekKey
    return toggledWeeks.has(weekKey) ? !defaultExpanded : defaultExpanded
  }, [toggledWeeks, mostRecentWeekKey])
  const toggleWeek = useCallback((weekKey: string) => {
    setToggledWeeks(prev => {
      const next = new Set(prev)
      next.has(weekKey) ? next.delete(weekKey) : next.add(weekKey)
      return next
    })
  }, [])

  function updateLink(i: number, val: string) {
    setLinks(prev => prev.map((l, idx) => (idx === i ? val : l)))
  }
  function addLink() {
    setLinks(prev => [...prev, ''])
  }
  function removeLink(i: number) {
    setLinks(prev => (prev.length <= 1 ? [''] : prev.filter((_, idx) => idx !== i)))
  }
  function toggleResultDebug(i: number) {
    setShowDebug(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  async function runImport() {
    const batch = links.map(l => l.trim()).filter(Boolean)
    if (!batch.length) { showToast('Paste a Lanetalk link', 'error'); return }
    setBusy(true)
    setResults([])
    setShowDebug(new Set())
    const out: LinkResult[] = []
    // Sequential, not parallel: the importer combines a player's links across
    // calls (reading prior imports for the week), so they must not race.
    for (const link of batch) {
      try {
        const data = await lanetalkImports.run(link)
        out.push({ url: link, summary: data })
      } catch (e: any) {
        out.push({ url: link, summary: { ok: false, stage: 'client', message: e?.message ?? 'Import failed' } })
      }
    }
    setResults(out)
    const okCount = out.filter(r => r.summary.ok).length
    const gamesCount = out.reduce((n, r) => n + (r.summary.games?.length ?? 0), 0)
    if (okCount === out.length) {
      showToast(
        out.length === 1
          ? `Imported ${gamesCount} games${out[0].summary.matchedPlayer ? ` for ${out[0].summary.matchedPlayer}` : ' (no player match)'}`
          : `Imported ${out.length} links · ${gamesCount} games`,
        'success',
      )
      setLinks([''])
    } else {
      showToast(`${okCount}/${out.length} links imported · ${out.length - okCount} failed`, okCount > 0 ? 'info' : 'error')
      // Keep only the failed links in the inputs so they can be retried/edited.
      setLinks(out.filter(r => !r.summary.ok).map(r => r.url))
    }
    await reload()
    setBusy(false)
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

  // Re-derive a week's imports from their stored payloads — re-matches games to
  // official scores and renumbers across links (fixes a lane-split night without
  // needing to clear/re-import the links). Gated in the UI to unconfirmed weeks.
  async function reprocess(weekId: string, title: string) {
    if (reprocessingWeek) return
    setReprocessingWeek(weekId)
    try {
      const res = await lanetalkImports.reprocessWeek(weekId)
      if (!res.ok) { showToast(res.message ?? 'Reprocess failed', 'error'); return }
      showToast(
        `Reprocessed ${title} · ${res.officialCount ?? 0} official across ${res.players ?? 0} player${res.players === 1 ? '' : 's'}`,
        'success',
      )
      await reload()
    } catch (e: any) {
      showToast(e?.message ?? 'Reprocess failed', 'error')
    } finally {
      setReprocessingWeek(null)
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lanetalk Import" onBack={() => navigation.goBack()} />
        <EmptyCard text="Admins only" style={{ marginTop: 12 }} />
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
          <Text style={styles.label}>Lanetalk share link{links.length > 1 ? 's' : ''}</Text>
          {links.map((link, i) => (
            <View key={i} style={[styles.linkRow, i > 0 && styles.linkRowSpacer]}>
              <TextInput
                style={[styles.input, styles.linkInput]}
                value={link}
                onChangeText={(t) => updateLink(i, t)}
                placeholder="http://shared.lanetalk.com/…"
                placeholderTextColor={colors.muted2}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!busy}
              />
              {links.length > 1 && (
                <TouchableOpacity
                  style={styles.removeLinkBtn}
                  onPress={() => removeLink(i)}
                  disabled={busy}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.removeLinkText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.addLinkBtn} onPress={addLink} disabled={busy} activeOpacity={0.7}>
            <Text style={styles.addLinkText}>+ Add another link</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={runImport}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={styles.buttonText}>Fetch & Import{links.filter(l => l.trim()).length > 1 ? ` (${links.filter(l => l.trim()).length})` : ''}</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>
            Paste a full share message or a bare link — the address is pulled out automatically. Games matching the bowler's recorded league scores are marked Official; the rest Recreational.
          </Text>
        </View>

        {results.map((r, i) => {
          const s = r.summary
          const expanded = showDebug.has(i)
          return (
            <View key={`${r.url}-${i}`} style={[styles.resultCard, s.ok ? styles.resultOk : styles.resultError]}>
              <View style={styles.resultHeaderRow}>
                <Text style={[styles.resultTitle, s.ok && styles.resultTitleOk]}>
                  {s.ok
                    ? `Imported ${s.games?.length ?? 0} games${s.matchedPlayer ? ` · ${s.matchedPlayer}` : ' · no player match'}`
                    : 'Import failed'}
                </Text>
                {!s.ok && !!s.stage && (
                  <View style={styles.stageBadge}><Text style={styles.stageBadgeText}>{s.stage}</Text></View>
                )}
              </View>
              <Text style={styles.resultUrl} numberOfLines={1}>{r.url}</Text>
              {!s.ok && <Text style={styles.resultMessage}>{s.message ?? 'Unknown error'}</Text>}
              {!s.ok && !!s.reqId && <Text style={styles.resultReqId}>reqId: {s.reqId}</Text>}
              {!s.ok && !!s.debug && Object.keys(s.debug).length > 0 && (
                <>
                  <TouchableOpacity onPress={() => toggleResultDebug(i)} style={styles.debugToggle}>
                    <Text style={styles.debugToggleText}>{expanded ? '▾ Hide details' : '▸ Show details'}</Text>
                  </TouchableOpacity>
                  {expanded && (
                    <Text style={styles.debugJson} selectable>{JSON.stringify(s.debug, null, 2)}</Text>
                  )}
                </>
              )}
            </View>
          )
        })}

        <Text style={styles.sectionHeader}>RECENT IMPORTS</Text>
        {weekGroups.length === 0 ? (
          <EmptyCard text="No imports yet." style={{ marginTop: 12 }} />
        ) : (
          weekGroups.map(wg => {
            const expanded = isWeekExpanded(wg.weekKey)
            const title = wg.weekNumber != null
              ? `Week ${wg.weekNumber}${wg.bowledAt ? ` - ${formatDate(wg.bowledAt)}` : ''}`
              : 'No week match'
            // Confirmation status for the week's LaneTalk props: pending props
            // → Unconfirmed; settled with none pending → Confirmed; a week that
            // never generated props gets no badge (nothing to confirm).
            const propsPending = propsByWeek.has(wg.weekKey)
            const propsConfirmed = !propsPending && settledPropWeeks.has(wg.weekKey)
            return (
              <View key={wg.weekKey} style={styles.weekCard}>
                <TouchableOpacity
                  style={[styles.weekHeader, expanded && styles.weekHeaderExpanded]}
                  onPress={() => toggleWeek(wg.weekKey)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.weekTitle}>{title}</Text>
                  {(propsPending || propsConfirmed) && (
                    <View style={[styles.statusBadge, propsPending ? styles.statusBadgePending : styles.statusBadgeDone]}>
                      <Text style={[styles.statusBadgeText, propsPending ? styles.statusBadgeTextPending : styles.statusBadgeTextDone]}>
                        {propsPending ? 'UNCONFIRMED' : 'CONFIRMED'}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.chevron, expanded && styles.chevronUp]}>›</Text>
                </TouchableOpacity>

                {/* Stat-prop settlement: shown while this week has unsettled
                    LaneTalk props (they settle on this Confirm clock, not at
                    archive — the data usually lands the next day). */}
                {expanded && propsByWeek.has(wg.weekKey) && (
                  <View style={styles.confirmRow}>
                    <TouchableOpacity
                      style={styles.confirmBtn}
                      onPress={() => setConfirmWeek({ weekId: wg.weekKey, title: title })}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.confirmBtnText}>
                        Confirm LaneTalk Data ({propsByWeek.get(wg.weekKey)!.length} props pending)
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Reprocess: re-match this week's stored games to official scores
                    and renumber across links. Hidden once props are confirmed
                    (re-matching after settlement would desync the official set)
                    and on the "no week" bucket (no real week to reprocess). */}
                {expanded && wg.weekKey !== 'unassigned' && !propsConfirmed && (
                  <View style={styles.confirmRow}>
                    <TouchableOpacity
                      style={[styles.reprocessBtn, reprocessingWeek === wg.weekKey && styles.buttonDisabled]}
                      onPress={() => reprocess(wg.weekKey, title)}
                      disabled={reprocessingWeek != null}
                      activeOpacity={0.7}
                    >
                      {reprocessingWeek === wg.weekKey
                        ? <ActivityIndicator color={colors.muted} />
                        : <Text style={styles.reprocessBtnText}>Reprocess &amp; Re-match Games</Text>}
                    </TouchableOpacity>
                  </View>
                )}

                {expanded && wg.players.map((g, gi) => (
                  <View key={g.key} style={[styles.groupCard, gi > 0 && styles.groupCardBorder]}>
                    <View style={styles.groupHeader}>
                      <Text style={styles.groupPlayer}>{g.playerName ?? 'No player match'}</Text>
                      <Text style={styles.groupUrl} numberOfLines={1}>{g.sourceUrl}</Text>
                    </View>
                    {g.games.map((game) => (
                      <View key={game.id} style={styles.gameRow}>
                        <Text style={[styles.gameCol, styles.gameLabel]}>Game {game.gameNumber}</Text>
                        <Text style={[styles.gameCol, styles.gameScore]}>{game.score ?? '—'}</Text>
                        <View style={[styles.gameCol, styles.gameClassCol]}>
                          <Dropdown
                            options={CLASSIFICATION_OPTIONS}
                            value={classEdits[game.id] ?? game.classification}
                            onChange={(key) => changeClassification(game, key)}
                            disabled={savingIds.has(game.id)}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )
          })
        )}
      </ScrollView>

      {/* Stat-prop settlement modal (mounted conditionally so state resets). */}
      {confirmWeek && (
        <LanetalkConfirmModal
          weekId={confirmWeek.weekId}
          weekTitle={confirmWeek.title}
          markets={propsByWeek.get(confirmWeek.weekId) ?? []}
          onClose={() => setConfirmWeek(null)}
          onDone={reload}
        />
      )}

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
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  linkRowSpacer: { marginTop: 8 },
  linkInput: { flex: 1 },
  removeLinkBtn: { paddingLeft: 12, paddingVertical: 4 },
  removeLinkText: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.muted },
  addLinkBtn: { marginTop: 10, alignSelf: 'flex-start' },
  addLinkText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.accent, letterSpacing: 0.3 },
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
  resultOk: { backgroundColor: 'rgba(74,222,128,0.10)', borderColor: 'rgba(74,222,128,0.45)' },
  resultHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultTitle: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.danger, letterSpacing: 0.3 },
  resultTitleOk: { color: colors.success },
  resultUrl: { fontFamily: fonts.barlow, fontSize: 11, color: colors.muted2, marginTop: 4 },
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
  weekCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  weekHeaderExpanded: { borderBottomWidth: 1, borderBottomColor: colors.border },
  confirmRow: { paddingHorizontal: 14, paddingTop: 12 },
  confirmBtn: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 0.4,
  },
  reprocessBtn: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reprocessBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
  },
  statusBadgePending: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: colors.gold },
  statusBadgeDone: { backgroundColor: 'rgba(74,222,128,0.12)', borderColor: colors.success },
  statusBadgeText: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1 },
  statusBadgeTextPending: { color: colors.gold },
  statusBadgeTextDone: { color: colors.success },
  weekTitle: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.3,
    marginRight: 8,
  },
  chevron: { fontFamily: fonts.barlowCondensed, fontSize: 20, color: colors.muted, transform: [{ rotate: '90deg' }] },
  chevronUp: { transform: [{ rotate: '-90deg' }] },
  groupCard: { paddingHorizontal: 14, paddingVertical: 12 },
  groupCardBorder: { borderTopWidth: 1, borderTopColor: colors.border },
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
  gameCol: { flex: 1 },
  gameClassCol: { alignItems: 'center' },
  gameLabel: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, textAlign: 'center' },
  gameScore: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.text, textAlign: 'center' },
})
