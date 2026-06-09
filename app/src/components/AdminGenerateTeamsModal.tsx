import { useState, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { usePendingStore } from '../stores/pendingStore'
import { useUiStore } from '../stores/uiStore'
import { weeks, rsvp, players, teamSlots, teams as teamsDb, games, scores, seasons, betMarkets } from '../utils/supabase/db'
import type { TablesInsert } from '../utils/supabase/database.types'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'

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

// Round-robin templates keyed by team *number* (1-based); mapped to team ids before insert.
type ScheduleTemplate = { game_number: number; team_a: number; team_b: number }

function buildSchedule(numTeams: number): ScheduleTemplate[] {
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
    genNumTeams, genTeamSize, genAvgSource,
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
        weeks.getCurrent(),
        seasons.list(),
        players.listActive(),
      ])
      const week = weekRes.data
      setAllSeasons(seasonsRes.data ?? [])
      setActivePlayers(playersRes.data ?? [])
      if (week) {
        setWeekId(week.id)
        const rsvpRes = await rsvp.listByWeek(week.id)
        const rsvps = rsvpRes.data ?? []
        setWeekRsvps(rsvps)
        // Default to two teams, sized to absorb the existing "In" RSVPs.
        const inCount = rsvps.filter((r: any) => r.status === 'in').length
        const teamSize = Math.max(2, Math.min(6, Math.floor(inCount / 2)))
        set({ genNumTeams: 2, genTeamSize: teamSize, genAvgSource: 'current-season', genTeams: null })
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
      // League avg is games-weighted (total pins / total games), matching the
      // Standings banner — not the unweighted mean of per-player averages.
      const totals = Object.values(byPlayer).reduce(
        (acc, { pins, games }) => ({ pins: acc.pins + pins, games: acc.games + games }),
        { pins: 0, games: 0 },
      )
      const leagueAvg = totals.games > 0 ? totals.pins / totals.games : 130

      // Only "In" players are drafted. Empty slots needed to even out the teams
      // are left as null-player fills carrying the league average (Season 1 style).
      const inIds = new Set(weekRsvps.filter((r: any) => r.status === 'in').map((r: any) => r.player_id))
      const realPlayers: GenPlayer[] = activePlayers
        .filter((player: any) => inIds.has(player.id))
        .map((player: any) => ({
          id: player.id,
          name: player.name,
          avg: playerAvgById[player.id] ?? leagueAvg,
          isFill: false,
          status: 'in' as const,
        }))

      realPlayers.sort((a, b) => b.avg - a.avg)

      // Snake draft
      const teamsArr: { players: GenPlayer[] }[] = Array.from({ length: genNumTeams }, () => ({ players: [] }))
      let forward = true, tIdx = 0
      const totalSlots = genNumTeams * genTeamSize

      function distribute(p: GenPlayer) {
        teamsArr[tIdx].players.push(p)
        if (forward) { tIdx++; if (tIdx === genNumTeams) { tIdx = genNumTeams - 1; forward = false } }
        else { tIdx--; if (tIdx < 0) { tIdx = 0; forward = true } }
      }

      realPlayers.slice(0, totalSlots).forEach(distribute)

      // Pad each short team with a null-player League Avg fill.
      teamsArr.forEach(t => {
        while (t.players.length < genTeamSize) {
          t.players.push({ id: null, name: 'League Avg Fill', avg: leagueAvg, isFill: true, status: 'fill' })
        }
      })

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
      const numTeams = (genTeams as any[]).length

      // Wipe the week's existing data: deleting its teams cascades to slots, games, and scores.
      const { error: eTeamsDel } = await teamsDb.removeByWeek(weekId)
      if (eTeamsDel) throw eTeamsDel

      // Create the teams first so slots/games can reference them by id.
      const teamRows: TablesInsert<'teams'>[] = Array.from({ length: numTeams }, (_, i) => ({
        week_id: weekId,
        team_number: i + 1,
      }))
      const { data: insertedTeams, error: eTeamsIns } = await teamsDb.insert(teamRows)
      if (eTeamsIns) throw eTeamsIns
      const teamIdByNumber = new Map<number, string>(
        (insertedTeams ?? []).map((t: any) => [t.team_number, t.id])
      )

      const slotRows: TablesInsert<'team_slots'>[] = (genTeams as any[]).flatMap((team, tIdx) =>
        team.players.map((player: GenPlayer, pIdx: number) => ({
          player_id: player.isFill ? null : player.id,
          team_id: teamIdByNumber.get(tIdx + 1)!,
          slot: pIdx,
          // is_fill is a generated column (player_id IS NULL) — never written
        }))
      )

      const scheduleRows: TablesInsert<'games'>[] = buildSchedule(numTeams).map(s => ({
        game_number: s.game_number,
        team_a_id: teamIdByNumber.get(s.team_a)!,
        team_b_id: teamIdByNumber.get(s.team_b)!,
      }))

      const { error: e2 } = await teamSlots.insert(slotRows)
      if (e2) throw e2
      if (scheduleRows.length) {
        const { error: e4 } = await games.insert(scheduleRows)
        if (e4) throw e4
      }

      const { error: e5 } = await weeks.update(weekId, { is_confirmed: true })
      if (e5) throw e5

      // O/U markets are owned by RSVP (games 1 & 2 already exist for every
      // in-player) and reference weeks not teams, so the teams.removeByWeek wipe
      // above leaves them intact. Team generation only needs to ADD markets for any
      // schedule game number not yet present — in practice game 3 when numTeams ∈
      // {3, 5}. Pass the schedule's distinct game numbers to the sync RPC, which
      // creates the missing markets server-side (current-season avg → floor+0.5),
      // idempotently.
      const scheduleGames = Array.from(new Set(buildSchedule(numTeams).map(s => s.game_number)))
      const { error: eSync } = await betMarkets.syncOUForWeek(weekId, scheduleGames)
      if (eSync) console.warn('Failed to sync O/U markets:', eSync.message)

      // Moneylines derive from the matchups (games rows) just written, so sync
      // them now too (one even-money market per game). Idempotent.
      const { error: eMl } = await betMarkets.syncMoneylineForWeek(weekId)
      if (eMl) console.warn('Failed to sync moneyline markets:', eMl.message)

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
                  options={[2, 3, 4, 5, 6].map(n => ({ key: String(n) as any, label: String(n) }))}
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

              <View style={styles.availRow}>
                <Text style={styles.availText}>
                  Need <Text style={styles.availAccent}>{requiredCount}</Text> players ·{' '}
                  <Text style={{ color: availCount >= requiredCount ? colors.success : colors.danger, fontFamily: fonts.barlow, fontSize: 12 }}>
                    {availCount} available
                  </Text>
                  {availCount < requiredCount ? (
                    <Text style={{ color: colors.muted }}> · {requiredCount - availCount} league-avg fill{requiredCount - availCount !== 1 ? 's' : ''}</Text>
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
                            <Text style={styles.playerName}>{player.name}</Text>
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
      {/* Rendered inside the Modal so toasts aren't occluded by the native modal layer. */}
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
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
