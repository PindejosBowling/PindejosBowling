import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { usePendingStore } from '../../stores/pendingStore'
import { useUiStore } from '../../stores/uiStore'
import { weeks, rsvp, players, teamSlots, teams as teamsDb, games, scores, seasons, betMarkets } from '../../utils/supabase/db'
import { aggregatePlayerAverages, type AverageRow } from '../../utils/averages'
import type { TablesInsert } from '../../utils/supabase/database.types'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'

interface Props {
  // Mount conditionally so the RSVP load reruns per open (generated-team state
  // lives in usePendingStore and is reset explicitly on close).
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
export type ScheduleTemplate = { game_number: number; team_a: number; team_b: number }

// Round-robin (circle method) rotation. The single source of night schedules —
// used by the generate-teams flow, the post-generation "Add Game" button, and
// PlayoffsScreen's materialize flow, so every week gets the same schedule shape.
//
// Produces `numGames` rounds of parallel pairings for `numTeams` teams (team
// numbers are 1-based). Pairings rotate so teams face a different opponent each
// game; once the unique rounds are exhausted (numGames > numTeams − 1) the
// rotation cycles back and repeats.
//
// Generation restricts team counts to even {2,4,6}, where every round is a set
// of perfect pairings with no bye. Odd counts still resolve via a rotating bye
// (a dummy team 0; pairings touching it are dropped) so the function is total,
// but a generated week is always even. `numGames` defaults to 2.
export function buildRotation(numTeams: number, numGames = 2): ScheduleTemplate[] {
  if (numTeams < 2 || numGames < 1) return []

  // Build the unique rounds via the circle method: fix the first team, rotate
  // the rest one position each round, pairing ends inward.
  const arr: number[] = Array.from({ length: numTeams }, (_, i) => i + 1)
  if (numTeams % 2 === 1) arr.push(0) // 0 = bye placeholder for odd counts
  const n = arr.length
  const uniqueRounds: { a: number; b: number }[][] = []
  for (let r = 0; r < n - 1; r++) {
    const pairings: { a: number; b: number }[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a !== 0 && b !== 0) pairings.push({ a, b })
    }
    uniqueRounds.push(pairings)
    arr.splice(1, 0, arr.pop()!) // rotate, keeping arr[0] fixed
  }

  const out: ScheduleTemplate[] = []
  for (let g = 1; g <= numGames; g++) {
    const round = uniqueRounds[(g - 1) % uniqueRounds.length]
    for (const p of round) out.push({ game_number: g, team_a: p.a, team_b: p.b })
  }
  return out
}

export default function AdminGenerateTeamsModal({ onClose }: Props) {
  const { showToast } = useUiStore()
  const {
    genNumTeams, genNumGames, genTeamSize, genAvgSource,
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
        const teamSize = Math.max(1, Math.min(6, Math.ceil(inCount / 2)))
        set({ genNumTeams: 2, genNumGames: 2, genTeamSize: teamSize, genAvgSource: 'all-time', genTeams: null })
      } else {
        setWeekId(null)
        setWeekRsvps([])
      }
    }
    load().finally(() => setRsvpLoading(false))
  }, [])

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
      // Fetch scores for the selected avg source. "Current season" is the one
      // that is active and out of registration — NOT the highest-numbered one,
      // which may be a new season still in registration (with no scores yet).
      const currentSeason = [...allSeasons].reverse().find((s: any) => s.is_active && !s.registration_open)
      const prevSeason = currentSeason
        ? [...allSeasons].reverse().find((s: any) => s.number < currentSeason.number)
        : allSeasons[allSeasons.length - 1]
      let scoreRows: any[] = []
      if (genAvgSource === 'last-season' && prevSeason) {
        scoreRows = (await scores.listBySeason(prevSeason.id)).data ?? []
      } else if (genAvgSource === 'current-season' && currentSeason) {
        scoreRows = (await scores.listBySeason(currentSeason.id)).data ?? []
      } else {
        scoreRows = (await scores.listAllArchived()).data ?? []
      }

      // Per-player + games-weighted league averages (canonical policy — see
      // utils/averages). Balancing accuracy depends on this matching what
      // Standings/matchups show for the same player.
      const avgAgg = aggregatePlayerAverages(scoreRows as AverageRow[])
      let leagueAvg: number
      if (avgAgg.leagueAvg > 0) {
        leagueAvg = avgAgg.leagueAvg
      } else if (genAvgSource === 'current-season' && prevSeason) {
        // Week 1: the current season has no archived scores yet, so anchor to
        // the prior season's league average. A completed season always exists,
        // so an empty result here means something is wrong — fail loudly.
        const prevRows = (await scores.listBySeason(prevSeason.id)).data ?? []
        const prevLeague = aggregatePlayerAverages(prevRows as AverageRow[]).leagueAvg
        if (prevLeague <= 0) throw new Error(`No archived scores found for prior season ${prevSeason.number}`)
        leagueAvg = prevLeague
      } else {
        throw new Error(`No archived scores found for avg source "${genAvgSource}"`)
      }

      // Only "In" players are drafted. Empty slots needed to even out the teams
      // are left as null-player fills carrying the league average (Season 1 style).
      const inIds = new Set(weekRsvps.filter((r: any) => r.status === 'in').map((r: any) => r.player_id))
      const realPlayers: GenPlayer[] = activePlayers
        .filter((player: any) => inIds.has(player.id))
        .map((player: any) => ({
          id: player.id,
          name: player.name,
          avg: avgAgg.byPlayer.get(player.id)?.avg ?? leagueAvg,
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
    } catch (e: any) {
      showToast(e?.message || 'Failed to generate teams', 'error')
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

      const rotation = buildRotation(numTeams, genNumGames)
      const scheduleRows: TablesInsert<'games'>[] = rotation.map(s => ({
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

      // O/U line ownership: RSVP owns the lines until teams exist; the roster
      // (team_slots) owns them once they do. The slot/game inserts above already
      // fired the DB resync triggers (pruning lines for undrafted players and
      // out-of-schedule game numbers, refunding their bets whole); these explicit
      // syncs are belt-and-braces and create any still-missing markets
      // (current-season avg → floor+0.5), idempotently.
      const scheduleGames = Array.from(new Set(rotation.map(s => s.game_number)))
      const { error: eSync } = await betMarkets.syncOUForWeek(weekId, scheduleGames)
      await betMarkets.syncLanetalkPropsForWeek(weekId)
      if (eSync) console.warn('Failed to sync O/U markets:', eSync.message)

      // Moneylines derive from the matchups (games rows) just written, so sync
      // them now too (one even-money market per game). Idempotent.
      const { error: eMl } = await betMarkets.syncMoneylineForWeek(weekId)
      if (eMl) console.warn('Failed to sync moneyline markets:', eMl.message)

      // Fresh matchups put the week back in a pre-game state: lines closed by
      // Start Game before the regen must reopen (survivors keep their status
      // through the syncs, which only create/prune).
      const { error: eReopen } = await betMarkets.reopenOUForWeek(weekId)
      if (eReopen) console.warn('Failed to reopen O/U markets:', eReopen.message)

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
    <BottomSheet
      title="Generate Teams"
      onClose={handleClose}
      busy={generating || confirming}
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="ghost" onPress={handleClose} />
        </View>
      }
    >
      {rsvpLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}
      {!rsvpLoading ? (<>
            <View style={styles.controlsCard}>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Number of Teams</Text>
                <ToggleGroup
                  options={[2, 4, 6].map(n => ({ key: String(n) as any, label: String(n) }))}
                  value={String(genNumTeams)}
                  onChange={v => set({ genNumTeams: parseInt(v), genTeams: null })}
                  style={styles.toggleGroup}
                />
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Number of Games</Text>
                <ToggleGroup
                  options={[2, 3, 4].map(n => ({ key: String(n) as any, label: String(n) }))}
                  value={String(genNumGames)}
                  onChange={v => set({ genNumGames: parseInt(v), genTeams: null })}
                  style={styles.toggleGroup}
                />
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Players per Team</Text>
                <ToggleGroup
                  options={[1, 2, 3, 4, 5, 6].map(n => ({ key: String(n) as any, label: String(n) }))}
                  value={String(genTeamSize)}
                  onChange={v => set({ genTeamSize: parseInt(v), genTeams: null })}
                  style={styles.toggleGroup}
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
                  style={styles.toggleGroup}
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

              <Button label="Generate" onPress={doGenerate} loading={generating} disabled={generating} style={styles.generateBtn} />
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

                <Button label="Use These Teams" onPress={useTeams} loading={confirming} disabled={confirming} style={styles.useTeamsBtn} />
              </>
            )}
      </>) : null}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsCard: {
    marginTop: 8,
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
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-start',
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
  generateBtn: { paddingVertical: 11 },
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
  useTeamsBtn: { marginTop: 4, marginBottom: 4 },
  footer: { marginTop: 14 },
})
