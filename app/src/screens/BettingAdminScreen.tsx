import { useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import { useBettingAdminData } from '../hooks/useBettingAdminData'
import { useRefresh } from '../hooks/useRefresh'
import { betLines as betLinesDb, placedBets as placedBetsDb } from '../utils/supabase/db'
import { computeAvgById, lineForAvg } from '../utils/betLines'
import { useUiStore } from '../stores/uiStore'

type LineCandidates = { current?: number; previous?: number; all?: number; league?: number }

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function BettingAdminScreen() {
  const navigation = useNavigation<Nav>()
  const { showToast } = useUiStore()
  const { loading, lines, betCountByLine, reload } = useBettingAdminData()
  const { refreshing, onRefresh } = useRefresh(reload)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})

  // Line-value editing (only allowed before any bet is placed on the line).
  const [editingLine, setEditingLine] = useState<any | null>(null)
  const [candidates, setCandidates] = useState<LineCandidates>({})
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [savingLine, setSavingLine] = useState(false)

  async function openEdit(line: any) {
    setEditingLine(line)
    setManualValue(String(Number(line.line)))
    setCandidates({})
    setLoadingCandidates(true)
    try {
      const [cur, prev, all] = await Promise.all([
        computeAvgById('current'),
        computeAvgById('previous'),
        computeAvgById('all'),
      ])
      const pid = line.player_id
      setCandidates({
        current: lineForAvg(cur.avgById[pid] ?? cur.leagueAvg),
        previous: lineForAvg(prev.avgById[pid] ?? prev.leagueAvg),
        all: lineForAvg(all.avgById[pid] ?? all.leagueAvg),
        league: lineForAvg(cur.leagueAvg),
      })
    } catch {
      showToast('Failed to compute averages', 'error')
    } finally {
      setLoadingCandidates(false)
    }
  }

  function closeEdit() {
    if (savingLine) return
    setEditingLine(null)
  }

  async function saveLine() {
    if (!editingLine) return
    const val = parseFloat(manualValue)
    if (isNaN(val)) { showToast('Enter a valid line value', 'error'); return }
    setSavingLine(true)
    try {
      // Re-check no bets exist (guards against a bet placed since the screen loaded).
      const { data: bets, error: betsErr } = await placedBetsDb.listByLine(editingLine.id)
      if (betsErr) { showToast(betsErr.message, 'error'); return }
      if (bets && bets.length > 0) {
        showToast('Line already has bets — cannot edit', 'error')
        setEditingLine(null)
        await reload()
        return
      }
      const { error } = await betLinesDb.update(editingLine.id, { line: val })
      if (error) { showToast(error.message, 'error'); return }
      setEditingLine(null)
      await reload()
      showToast('Line updated', 'success')
    } catch {
      showToast('Failed to update line', 'error')
    } finally {
      setSavingLine(false)
    }
  }

  // Group lines by game_number
  const linesByGame = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const line of lines) {
      if (!map[line.game_number]) map[line.game_number] = []
      map[line.game_number].push(line)
    }
    return map
  }, [lines])

  const sortedGameNumbers = useMemo(
    () => Object.keys(linesByGame).map(Number).sort(),
    [linesByGame]
  )

  async function toggleLine(lineId: string, newValue: boolean) {
    setToggling(prev => ({ ...prev, [lineId]: true }))
    try {
      const { error } = await betLinesDb.update(lineId, { is_open: newValue })
      if (error) showToast(error.message, 'error')
      else await reload()
    } catch {
      showToast('Failed to update line', 'error')
    } finally {
      setToggling(prev => ({ ...prev, [lineId]: false }))
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bet Lines" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {sortedGameNumbers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No lines for this week</Text>
            <Text style={styles.emptyHint}>Lines are created from RSVP — mark players in</Text>
          </View>
        ) : (
          sortedGameNumbers.map(gameNum => (
            <View key={gameNum}>
              <Text style={styles.gameLabel}>GAME {gameNum}</Text>
              <View style={styles.card}>
                {linesByGame[gameNum].map((line, idx) => {
                  const count = betCountByLine[line.id] ?? 0
                  const isLast = idx === linesByGame[gameNum].length - 1
                  // Editable only before any bet is placed and before settlement.
                  const editable = count === 0 && !line.result
                  return (
                    <View key={line.id} style={[styles.lineRow, !isLast && styles.lineRowBorder]}>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        activeOpacity={editable ? 0.6 : 1}
                        onPress={editable ? () => openEdit(line) : undefined}
                      >
                        <Text style={styles.playerName}>{line.players?.name ?? '—'}</Text>
                        <Text style={styles.lineDetail}>
                          LINE {Number(line.line).toFixed(1)}
                          {count > 0
                            ? `  ·  ${count} bet${count !== 1 ? 's' : ''}`
                            : '  ·  no bets'}
                          {line.result ? `  ·  ${line.result.toUpperCase()}` : ''}
                          {editable ? '  ·  EDIT' : ''}
                        </Text>
                      </TouchableOpacity>
                      <Switch
                        value={line.is_open}
                        onValueChange={v => toggleLine(line.id, v)}
                        disabled={!!toggling[line.id] || !!line.result}
                        trackColor={{ false: colors.surface3, true: colors.accentDim }}
                        thumbColor={line.is_open ? colors.accent : colors.muted}
                      />
                    </View>
                  )
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!editingLine} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeEdit} activeOpacity={1} />
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>Edit Line</Text>
            <Text style={styles.editSubtitle}>
              {editingLine?.players?.name ?? '—'} · Game {editingLine?.game_number}
            </Text>

            <Text style={styles.editLabel}>SET FROM AVERAGE</Text>
            {loadingCandidates ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
            ) : (
              <View style={styles.candRow}>
                {([
                  ['current', 'Current'],
                  ['previous', 'Previous'],
                  ['all', 'All-time'],
                  ['league', 'League'],
                ] as const).map(([key, label]) => {
                  const v = candidates[key]
                  const selected = v !== undefined && parseFloat(manualValue) === v
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.candBtn, selected && styles.candBtnActive]}
                      onPress={v !== undefined ? () => setManualValue(String(v)) : undefined}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.candLabel, selected && styles.candLabelActive]}>{label}</Text>
                      <Text style={[styles.candVal, selected && styles.candLabelActive]}>
                        {v !== undefined ? v.toFixed(1) : '—'}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}

            <Text style={styles.editLabel}>LINE VALUE</Text>
            <TextInput
              style={styles.editInput}
              value={manualValue}
              onChangeText={setManualValue}
              keyboardType="decimal-pad"
              placeholder="e.g. 142.5"
              placeholderTextColor={colors.muted2}
            />
            <Text style={styles.editHint}>Use a half-pin value (e.g. 142.5) so a score can never push.</Text>

            <View style={styles.editBtnRow}>
              <TouchableOpacity style={styles.editCancelBtn} onPress={closeEdit} disabled={savingLine} activeOpacity={0.7}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editSaveBtn, savingLine && styles.editSaveDisabled]} onPress={saveLine} disabled={savingLine} activeOpacity={0.7}>
                {savingLine ? <ActivityIndicator size="small" color={colors.bg} style={{ marginRight: 8 }} /> : null}
                <Text style={styles.editSaveText}>{savingLine ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {/* Inside the Modal so toasts aren't occluded by the native modal layer. */}
        <Toast />
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.accent,
    marginTop: 16,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  playerName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  lineDetail: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  emptyHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted2,
    textAlign: 'center',
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  editSheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  editTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  editSubtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 12,
  },
  editLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 6,
  },
  candRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  candBtn: {
    flexGrow: 1,
    minWidth: '22%',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface2,
  },
  candBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  candLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
  },
  candVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
  },
  candLabelActive: {
    color: colors.accent,
  },
  editInput: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
  },
  editHint: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted2,
    marginTop: 6,
  },
  editBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  editCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  editCancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  editSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveDisabled: {
    backgroundColor: colors.surface3,
  },
  editSaveText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
})
