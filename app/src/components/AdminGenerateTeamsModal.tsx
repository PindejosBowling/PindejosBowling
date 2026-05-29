import { useState, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { usePendingStore } from '../stores/pendingStore'
import { useUiStore } from '../stores/uiStore'
import { weeks, rsvp, players, teamSlots, gameSchedule, scores, seasons } from '../utils/supabase/db'
import type { TablesInsert } from '../utils/supabase/database.types'
import { colors, fonts, radius } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
}

interface GenPlayer {
  id: string | null
  name: string
  avg: number
  isFill: boolean
  status: 'in' | 'out' | 'fill'
}

function buildSchedule(numTeams: number): Omit<TablesInsert<'game_schedule'>, 'week_id'>[] {
  if (numTeams === 2) return [
    { game_number: 1, team_a: 1, team_b: 2 },
    { game_number: 2, team_a: 1, team_b: 2 },
  ]
  if (numTeams === 3) return [
    { game_number: 1, team_a: 1, team_b: 2 },
    { game_number: 2, team_a: 1, team_b: 3 },
    { game_number: 3, team_a: 2, team_b: 3 },
  ]
  if (numTeams === 4) return [
    { game_number: 1, team_a: 1, team_b: 3 },
    { game_number: 1, team_a: 2, team_b: 4 },
    { game_number: 2, team_a: 4, team_b: 1 },
    { game_number: 2, team_a: 3, team_b: 2 },
  ]
  if (numTeams === 5) return [
    { game_number: 1, team_a: 1, team_b: 2 },
    { game_number: 1, team_a: 3, team_b: 4 },
    { game_number: 2, team_a: 1, team_b: 5 },
    { game_number: 2, team_a: 2, team_b: 4 },
    { game_number: 3, team_a: 2, team_b: 3 },
    { game_number: 3, team_a: 4, team_b: 5 },
  ]
  if (numTeams === 6) return [
    { game_number: 1, team_a: 1, team_b: 2 },
    { game_number: 1, team_a: 3, team_b: 4 },
    { game_number: 1, team_a: 5, team_b: 6 },
    { game_number: 2, team_a: 2, team_b: 3 },
    { game_number: 2, team_a: 4, team_b: 5 },
    { game_number: 2, team_a: 6, team_b: 1 },
  ]
  return []
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <View style={styles.toggleGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[styles.toggleBtn, value === o.key && styles.toggleBtnActive]}
          onPress={() => onChange(o.key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.toggleBtnText, value === o.key && styles.toggleBtnTextActive]}>
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function AdminGenerateTeamsModal({ visible, onClose }: Props) {
  const { showToast } = useUiStore()
  const {
    genNumTeams, genTeamSize, genAvgSource, genFillMode, genFillToSize,
    genTeams, genSwapTarget, set,
  } = usePendingStore()

  const [rsvpLoading, setRsvpLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [weekId, setWeekId] = useState<string | null>(null)
  const [weekRsvps, setWeekRsvps] = useState<any[]>([])
  const [activePlayers, setActivePlayers] = useState<any[]>([])
  const [allSeasons, setAllSeasons] = useState<any[]>([])

  useEffect(() => {
    if (!visible) return
    setRsvpLoading(true)
    async function load() {
      const [weekRes, seasonsRes, playersRes] = await Promise.all([
        weeks.getActive(),
        seasons.list(),
        players.listActive(),
      ])
      const week = weekRes.data
      setAllSeasons(seasonsRes.data ?? [])
      setActivePlayers(playersRes.data ?? [])
      if (week) {
        setWeekId(week.id)
        const rsvpRes = await rsvp.listByWeek(week.id)
        setWeekRsvps(rsvpRes.data ?? [])
      } else {
        setWeekId(null)
        setWeekRsvps([])
      }
    }
    load().finally(() => setRsvpLoading(false))
  }, [visible])

  const availCount = weekRsvps.filter((r: any) => r.status === 'in').length
  const requiredCount = genNumTeams * genTeamSize

  function isSwapTarget(tIdx: number, pIdx: number) {
    return genSwapTarget?.team === tIdx && genSwapTarget?.idx === pIdx
  }

  function teamTotal(team: any) {
    return Math.round(team.players.reduce((s: number, p: any) => s + p.avg, 0))
  }

  async function doGenerate() {
    if (!weekId) { showToast('No active week', 'error'); return }
    setGenerating(true)
    try {
      // Fetch scores for the selected avg source
      const prevSeason = allSeasons.length >= 2 ? allSeasons[allSeasons.length - 2] : allSeasons[0]
      const currentSeason = allSeasons[allSeasons.length - 1]
      let scoreRows: any[] = []
      if (genAvgSource === 'last-season' && prevSeason) {
        scoreRows = (await scores.listBySeason(prevSeason.id)).data ?? []
      } else if (genAvgSource === 'current-season' && currentSeason) {
        scoreRows = (await scores.listBySeason(currentSeason.id)).data ?? []
      } else {
        scoreRows = (await scores.listAllArchived()).data ?? []
      }

      // Aggregate per-player averages
      const byPlayer: Record<string, { pins: number; games: number }> = {}
      for (const row of scoreRows) {
        const pid = row.team_slots?.player_id
        if (!pid) continue
        if (!byPlayer[pid]) byPlayer[pid] = { pins: 0, games: 0 }
        byPlayer[pid].pins += row.score ?? 0
        byPlayer[pid].games += 1
      }
      const playerAvgById: Record<string, number> = Object.fromEntries(
        Object.entries(byPlayer).map(([pid, { pins, games }]) => [pid, games > 0 ? pins / games : 0])
      )
      const avgVals = Object.values(playerAvgById)
      const leagueAvg = avgVals.length > 0 ? avgVals.reduce((a, b) => a + b, 0) / avgVals.length : 130

      // Split roster into available (in) and MIA
      const inIds = new Set(weekRsvps.filter((r: any) => r.status === 'in').map((r: any) => r.player_id))
      const realPlayers: GenPlayer[] = []
      const miaPlayers: GenPlayer[] = []

      for (const player of activePlayers) {
        const sourceAvg = playerAvgById[player.id]
        if (inIds.has(player.id)) {
          realPlayers.push({ id: player.id, name: player.name, avg: sourceAvg ?? leagueAvg, isFill: false, status: 'in' })
        } else {
          const miaAvg = genFillMode === 'League Avg' ? leagueAvg : (sourceAvg ?? leagueAvg)
          miaPlayers.push({ id: player.id, name: player.name, avg: miaAvg, isFill: false, status: 'out' })
        }
      }

      realPlayers.sort((a, b) => b.avg - a.avg)
      miaPlayers.sort((a, b) => b.avg - a.avg)

      // Snake draft
      const teamsArr: { players: GenPlayer[] }[] = Array.from({ length: genNumTeams }, () => ({ players: [] }))
      let forward = true, tIdx = 0
      const totalSlots = genNumTeams * genTeamSize

      function distribute(p: GenPlayer) {
        teamsArr[tIdx].players.push(p)
        if (forward) { tIdx++; if (tIdx === genNumTeams) { tIdx = genNumTeams - 1; forward = false } }
        else { tIdx--; if (tIdx < 0) { tIdx = 0; forward = true } }
      }

      const useReal = realPlayers.slice(0, totalSlots)
      useReal.forEach(distribute)
      if (useReal.length < totalSlots && !genFillToSize) {
        miaPlayers.slice(0, totalSlots - useReal.length).forEach(distribute)
      }
      if (genFillToSize) {
        teamsArr.forEach(t => {
          while (t.players.length < genTeamSize) {
            t.players.push({ id: null, name: 'League Avg Fill', avg: leagueAvg, isFill: true, status: 'fill' })
          }
        })
      }

      set({ genTeams: teamsArr, genSwapTarget: null })
    } catch {
      showToast('Failed to generate teams', 'error')
    } finally {
      setGenerating(false)
    }
  }

  function handleSwap(tIdx: number, pIdx: number) {
    if (!genSwapTarget) {
      set({ genSwapTarget: { team: tIdx, idx: pIdx } })
    } else if (genSwapTarget.team === tIdx && genSwapTarget.idx === pIdx) {
      set({ genSwapTarget: null })
    } else {
      const teams = JSON.parse(JSON.stringify(genTeams))
      const a = teams[genSwapTarget.team].players[genSwapTarget.idx]
      const b = teams[tIdx].players[pIdx]
      teams[genSwapTarget.team].players[genSwapTarget.idx] = b
      teams[tIdx].players[pIdx] = a
      set({ genTeams: teams, genSwapTarget: null })
    }
  }

  async function useTeams() {
    if (!genTeams || !weekId) return
    setConfirming(true)
    try {
      const slotRows: TablesInsert<'team_slots'>[] = (genTeams as any[]).flatMap((team, tIdx) =>
        team.players.map((player: GenPlayer, pIdx: number) => ({
          week_id: weekId,
          player_id: player.isFill ? null : player.id,
          team_number: tIdx + 1,
          slot: pIdx,
          is_fill: player.isFill,
        }))
      )

      const scheduleRows: TablesInsert<'game_schedule'>[] = buildSchedule((genTeams as any[]).length).map(s => ({
        ...s,
        week_id: weekId,
      }))

      const { data: existingSlots } = await teamSlots.listByWeek(weekId)
      const existingSlotIds = (existingSlots ?? []).map((s: any) => s.id)
      if (existingSlotIds.length > 0) {
        const { error: e0 } = await scores.removeBySlotIds(existingSlotIds)
        if (e0) throw e0
      }

      const { error: e1 } = await teamSlots.removeByWeek(weekId)
      if (e1) throw e1
      const { error: e2 } = await teamSlots.insert(slotRows)
      if (e2) throw e2
      const { error: e3 } = await gameSchedule.removeByWeek(weekId)
      if (e3) throw e3
      if (scheduleRows.length) {
        const { error: e4 } = await gameSchedule.insert(scheduleRows)
        if (e4) throw e4
      }

      showToast('Teams saved', 'success')
      set({ genTeams: null, genSwapTarget: null })
      onClose()
    } catch {
      showToast('Failed to save teams', 'error')
    } finally {
      setConfirming(false)
    }
  }

  function handleClose() {
    if (generating || confirming) return
    set({ genTeams: null, genSwapTarget: null })
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Generate Teams</Text>

          <ScrollView style={styles.scrollArea} contentContainerStyle={[styles.scrollContent, rsvpLoading && styles.scrollContentCentered]} showsVerticalScrollIndicator={false}>
            {rsvpLoading ? (
              <ActivityIndicator size="large" color={colors.accent} />
            ) : null}
            {!rsvpLoading ? (<>
            <View style={styles.controlsCard}>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Number of Teams</Text>
                <ToggleGroup
                  options={[2, 3, 4, 5, 6].map(n => ({ key: String(n) as any, label: String(n) }))}
                  value={String(genNumTeams)}
                  onChange={v => set({ genNumTeams: parseInt(v), genTeams: null })}
                />
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Players per Team</Text>
                <ToggleGroup
                  options={[2, 3, 4, 5].map(n => ({ key: String(n) as any, label: String(n) }))}
                  value={String(genTeamSize)}
                  onChange={v => set({ genTeamSize: parseInt(v), genTeams: null })}
                />
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Avg Source</Text>
                <ToggleGroup
                  options={[
                    { key: 'last-season', label: 'Last Season' },
                    { key: 'current-season', label: 'Current' },
                    { key: 'all-time', label: 'All-time' },
                  ]}
                  value={genAvgSource}
                  onChange={v => set({ genAvgSource: v })}
                />
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Fill MIA Players With</Text>
                <ToggleGroup
                  options={[
                    { key: 'League Avg', label: 'League Avg' },
                    { key: 'Their Avg', label: 'Their Avg' },
                  ]}
                  value={genFillMode}
                  onChange={v => set({ genFillMode: v })}
                />
              </View>

              <View style={styles.switchRow}>
                <Switch
                  value={genFillToSize}
                  onValueChange={v => set({ genFillToSize: v })}
                  trackColor={{ false: colors.surface3, true: colors.accentDim }}
                  thumbColor={genFillToSize ? colors.accent : colors.muted}
                />
                <Text style={styles.switchLabel}>Pad short teams with league avg placeholders</Text>
              </View>

              <View style={styles.availRow}>
                <Text style={styles.availText}>
                  Need <Text style={styles.availAccent}>{requiredCount}</Text> players ·{' '}
                  <Text style={{ color: availCount >= requiredCount ? colors.success : colors.danger, fontFamily: fonts.barlow, fontSize: 12 }}>
                    {availCount} available
                  </Text>
                  {availCount < requiredCount && !genFillToSize ? (
                    <Text style={{ color: colors.danger }}> · Short {requiredCount - availCount}</Text>
                  ) : null}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
                onPress={doGenerate}
                disabled={generating}
                activeOpacity={0.7}
              >
                {generating ? (
                  <ActivityIndicator size="small" color={colors.bg} style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.generateBtnText}>{generating ? 'Generating…' : 'Generate'}</Text>
              </TouchableOpacity>
            </View>

            {genTeams && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>GENERATED TEAMS</Text>
                  <Text style={styles.swapHint}>
                    {genSwapTarget ? 'Tap a player to swap' : 'Tap "Swap" to start'}
                  </Text>
                </View>

                {(genTeams as any[]).map((team, tIdx) => (
                  <View key={tIdx} style={styles.teamCard}>
                    <View style={styles.teamHead}>
                      <Text style={styles.teamName}>Team {tIdx + 1}</Text>
                      <Text style={styles.teamTotal}>{teamTotal(team)}</Text>
                    </View>
                    {team.players.map((player: GenPlayer, pIdx: number) => (
                      <View key={pIdx} style={styles.playerRow}>
                        <View style={{ flex: 1 }}>
                          {player.isFill ? (
                            <Text style={[styles.playerName, { color: colors.muted, fontStyle: 'italic' }]}>
                              League Avg Fill<Text style={styles.fillTag}> FILL</Text>
                            </Text>
                          ) : (
                            <Text style={styles.playerName}>
                              {player.name}
                              {player.status === 'out' ? <Text style={styles.outTag}> OUT</Text> : null}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.playerAvg}>{player.avg.toFixed(1)}</Text>
                        {!player.isFill && (
                          <TouchableOpacity
                            style={[styles.swapBtn, isSwapTarget(tIdx, pIdx) && styles.swapBtnActive]}
                            onPress={() => handleSwap(tIdx, pIdx)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.swapBtnText, isSwapTarget(tIdx, pIdx) && styles.swapBtnTextActive]}>
                              {isSwapTarget(tIdx, pIdx) ? 'Pick swap' : 'Swap'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                ))}

                <TouchableOpacity
                  style={[styles.useTeamsBtn, confirming && styles.useTeamsBtnDisabled]}
                  onPress={useTeams}
                  disabled={confirming}
                  activeOpacity={0.7}
                >
                  {confirming ? <ActivityIndicator size="small" color={colors.bg} style={{ marginRight: 8 }} /> : null}
                  <Text style={styles.useTeamsBtnText}>{confirming ? 'Saving…' : 'Use These Teams'}</Text>
                </TouchableOpacity>
              </>
            )}
            </>) : null}
          </ScrollView>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={handleClose}
              disabled={generating || confirming}
              activeOpacity={0.7}
            >
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 24,
    paddingVertical: 60,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  scrollContentCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsCard: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  controlRow: {
    gap: 8,
  },
  controlLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  toggleGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  toggleBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  toggleBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  toggleBtnTextActive: {
    color: colors.accent,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface3,
    borderRadius: radius.cardSm,
    padding: 10,
  },
  switchLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  availRow: {
    paddingVertical: 2,
  },
  availText: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  availAccent: {
    color: colors.accent,
    fontWeight: '700',
  },
  generateBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnDisabled: {
    backgroundColor: colors.surface3,
  },
  generateBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  swapHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
  },
  teamCard: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    overflow: 'hidden',
  },
  teamHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  teamName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
  },
  teamTotal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.accent,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
  },
  outTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.danger,
    letterSpacing: 1,
  },
  fillTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  playerAvg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    minWidth: 32,
    textAlign: 'right',
  },
  swapBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  swapBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  swapBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  swapBtnTextActive: {
    color: colors.accent,
  },
  useTeamsBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  useTeamsBtnDisabled: {
    backgroundColor: colors.surface3,
  },
  useTeamsBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
  btnRow: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btnCancel: {
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
})
