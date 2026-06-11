import { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import ToggleGroup from '../components/ui/ToggleGroup'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import EmptyCard from '../components/ui/EmptyCard'
import Toast from '../components/ui/Toast'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useRefresh } from '../hooks/useRefresh'
import { usePlayoffDraftData, computeDraftTurnSeed, DraftType } from '../hooks/usePlayoffDraftData'
import { computeStandingsFromSupabase } from '../hooks/useStandingsData'
import { playoffDrafts, teams, games, betMarkets } from '../utils/supabase/db'
import { buildSchedule } from '../components/admin/AdminGenerateTeamsModal'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const STATUS_LABEL: Record<string, string> = {
  setup: 'Setting up',
  drafting: 'Draft live',
  completed: 'Draft complete',
  materialized: 'Teams created',
}

export default function PlayoffsScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const myPlayerId = useAuthStore(s => s.playerId)
  const showToast = useUiStore(s => s.showToast)

  const { loading, seasonId, rawDraft, rawWeeks, rawDraftablePlayers, rawScores, rawSchedule, reload } =
    usePlayoffDraftData()
  const { refreshing, onRefresh } = useRefresh(reload)

  // Setup form state (admin, no draft yet)
  const [captainIds, setCaptainIds] = useState<string[]>([])
  const [setupWeekId, setSetupWeekId] = useState<string | null>(null)
  const [setupType, setSetupType] = useState<DraftType>('snake')
  const [saving, setSaving] = useState(false)

  // Conditionally-mounted confirm sheets
  const [confirmPick, setConfirmPick] = useState<{ playerId: string; name: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmMaterialize, setConfirmMaterialize] = useState(false)

  // Current-season standings rank drives captain seed order at setup.
  const standings = useMemo(
    () => computeStandingsFromSupabase(rawScores, rawSchedule, seasonId),
    [rawScores, rawSchedule, seasonId],
  )
  const rankByPlayer = useMemo(() => {
    const m = new Map<string, number>()
    standings.forEach((r, i) => m.set(r.playerId, i + 1))
    return m
  }, [standings])

  // Draftable players (registered + active), standings-ordered for the setup list.
  const candidates = useMemo(
    () =>
      rawDraftablePlayers
        .map((r: any) => ({ playerId: r.players.id as string, name: r.players.name as string }))
        .sort((a, b) => (rankByPlayer.get(a.playerId) ?? 999) - (rankByPlayer.get(b.playerId) ?? 999)),
    [rawDraftablePlayers, rankByPlayer],
  )

  const weekOptions = useMemo(
    () =>
      rawWeeks
        .filter((w: any) => !w.is_archived)
        .map((w: any) => ({ key: w.id as string, label: `Week ${w.week_number}` })),
    [rawWeeks],
  )

  // Draft view model: captains seed-ordered with their rosters, remaining pool,
  // and whose turn it is (mirrors the server's playoff_current_turn).
  const draft = useMemo(() => {
    if (!rawDraft) return null
    const captains = [...(rawDraft.playoff_draft_captains ?? [])]
      .sort((a: any, b: any) => a.seed - b.seed)
      .map((c: any) => ({
        id: c.id as string,
        playerId: c.player_id as string,
        name: c.players?.name ?? '?',
        seed: c.seed as number,
      }))
    const picks = [...(rawDraft.playoff_draft_picks ?? [])]
      .sort((a: any, b: any) => a.pick_number - b.pick_number)
      .map((p: any) => ({
        id: p.id as string,
        pickNumber: p.pick_number as number,
        captainPlayerId: p.captain_player_id as string,
        pickedPlayerId: p.picked_player_id as string,
        pickedName: p.picked?.name ?? '?',
      }))
    const pickedIds = new Set(picks.map(p => p.pickedPlayerId))
    const pool = [...(rawDraft.playoff_draft_pool ?? [])]
      .map((e: any) => ({ id: e.id as string, playerId: e.player_id as string, name: e.players?.name ?? '?' }))
      .sort((a, b) => (rankByPlayer.get(a.playerId) ?? 999) - (rankByPlayer.get(b.playerId) ?? 999))
    const remaining = pool.filter(e => !pickedIds.has(e.playerId))
    const onClockSeed =
      rawDraft.status === 'drafting'
        ? computeDraftTurnSeed(rawDraft.draft_type as DraftType, captains.length, picks.length, remaining.length)
        : null
    const onClock = onClockSeed != null ? captains.find(c => c.seed === onClockSeed) ?? null : null
    const week = rawWeeks.find((w: any) => w.id === rawDraft.week_id)
    return {
      id: rawDraft.id as string,
      status: rawDraft.status as string,
      draftType: rawDraft.draft_type as DraftType,
      weekId: rawDraft.week_id as string,
      weekNumber: week?.week_number as number | undefined,
      captains,
      picks,
      pool,
      remaining,
      onClock,
      rosters: captains.map(c => ({
        ...c,
        picks: picks.filter(p => p.captainPlayerId === c.playerId),
      })),
    }
  }, [rawDraft, rawWeeks, rankByPlayer])

  const myTurn = !!draft?.onClock && draft.onClock.playerId === myPlayerId
  const canPick = draft?.status === 'drafting' && (myTurn || isAdmin)

  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setSaving(true)
    try {
      const { error } = await action()
      if (error) {
        showToast(error.message, 'error')
      } else {
        showToast(success, 'success')
        await reload()
      }
    } catch {
      showToast('Action failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleCaptain = (playerId: string) =>
    setCaptainIds(ids => (ids.includes(playerId) ? ids.filter(id => id !== playerId) : [...ids, playerId]))

  // Materialize via the RPC, then lay the standard rails the generate-teams
  // flow lays after writing teams: the schedule (games) for the team count and
  // the betting-market syncs. Sync failures are warnings there — same here.
  const materializeAndSchedule = async (): Promise<{ error: { message: string } | null }> => {
    if (!draft) return { error: { message: 'No draft' } }
    const res = await playoffDrafts.materializeTeams(draft.id)
    if (res.error) return res

    const { data: teamRows, error: teamsErr } = await teams.listByWeek(draft.weekId)
    if (teamsErr) return { error: teamsErr }
    const teamIdByNumber = new Map<number, string>((teamRows ?? []).map((t: any) => [t.team_number, t.id]))

    const schedule = buildSchedule((teamRows ?? []).length)
    if (schedule.length) {
      const { error: gamesErr } = await games.insert(
        schedule.map(s => ({
          game_number: s.game_number,
          team_a_id: teamIdByNumber.get(s.team_a)!,
          team_b_id: teamIdByNumber.get(s.team_b)!,
        })),
      )
      if (gamesErr) return { error: gamesErr }
    }

    const scheduleGames = Array.from(new Set(schedule.map(s => s.game_number)))
    const { error: ouErr } = await betMarkets.syncOUForWeek(draft.weekId, scheduleGames)
    if (ouErr) console.warn('Failed to sync O/U markets:', ouErr.message)
    await betMarkets.syncLanetalkPropsForWeek(draft.weekId)
    const { error: mlErr } = await betMarkets.syncMoneylineForWeek(draft.weekId)
    if (mlErr) console.warn('Failed to sync moneyline markets:', mlErr.message)

    return { error: null }
  }

  const createDraft = async () => {
    if (!seasonId || !setupWeekId || captainIds.length < 2) return
    // Seed order = current standings order among the chosen captains.
    const ordered = [...captainIds].sort(
      (a, b) => (rankByPlayer.get(a) ?? 999) - (rankByPlayer.get(b) ?? 999),
    )
    await run(() => playoffDrafts.create(seasonId, setupWeekId, setupType, ordered), 'Draft created')
    setCaptainIds([])
    setSetupWeekId(null)
  }

  if (loading) return <LoadingView label="Loading playoffs…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Playoffs"
        subtitle={draft ? STATUS_LABEL[draft.status] : 'Captain draft'}
        onBack={() => navigation.navigate('MoreHome')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {!seasonId ? (
          <EmptyCard text="No active season — playoffs open once a season is live." style={styles.fieldGap} />
        ) : !draft ? (
          isAdmin ? (
            <>
              <Text style={styles.sectionHeader}>SET UP THE DRAFT</Text>
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>CAPTAINS (TAP TO SELECT — SEEDS FOLLOW STANDINGS)</Text>
                {candidates.map(p => {
                  const selected = captainIds.includes(p.playerId)
                  return (
                    <TouchableOpacity
                      key={p.playerId}
                      style={styles.row}
                      onPress={() => toggleCaptain(p.playerId)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.rowRank}>#{rankByPlayer.get(p.playerId) ?? '—'}</Text>
                      <Text style={[styles.rowName, selected && styles.rowNameSelected]}>{p.name}</Text>
                      {selected && <Text style={styles.rowCheck}>✓</Text>}
                    </TouchableOpacity>
                  )
                })}
                {candidates.length === 0 && (
                  <Text style={styles.muted}>No registered active players found for this season.</Text>
                )}

                <Text style={[styles.fieldLabel, styles.fieldGap]}>PLAYOFF WEEK</Text>
                <ToggleGroup
                  options={weekOptions}
                  value={setupWeekId}
                  onChange={setSetupWeekId}
                  empty="No open weeks in this season"
                  scrollable
                />

                <Text style={[styles.fieldLabel, styles.fieldGap]}>PICK ORDER</Text>
                <ToggleGroup
                  options={[
                    { key: 'snake', label: 'Snake (1·2·2·1)' },
                    { key: 'straight', label: 'Straight (1·2·1·2)' },
                  ]}
                  value={setupType}
                  onChange={k => setSetupType(k as DraftType)}
                />

                <View style={styles.fieldGap}>
                  <Button
                    label={`Create draft (${captainIds.length} captains)`}
                    onPress={createDraft}
                    loading={saving}
                    disabled={captainIds.length < 2 || !setupWeekId}
                    size="lg"
                  />
                </View>
              </View>
            </>
          ) : (
            <EmptyCard text="No draft yet — the commissioner hasn't set up the playoff draft." style={styles.fieldGap} />
          )
        ) : (
          <>
            {/* Status banner */}
            {draft.status === 'drafting' && draft.onClock && (
              <View style={[styles.banner, myTurn && styles.bannerMyTurn]}>
                <Text style={[styles.bannerText, myTurn && styles.bannerTextMyTurn]}>
                  {myTurn ? 'You are on the clock' : `On the clock: ${draft.onClock.name}`}
                </Text>
                <Text style={styles.bannerSub}>
                  Pick {draft.picks.length + 1} · {draft.remaining.length} players left
                  {draft.weekNumber != null ? ` · Week ${draft.weekNumber}` : ''}
                </Text>
              </View>
            )}
            {draft.status === 'completed' && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Draft complete</Text>
                <Text style={styles.bannerSub}>
                  {isAdmin
                    ? 'Create the teams to lock rosters onto the playoff week.'
                    : 'Waiting on the commissioner to create teams.'}
                </Text>
              </View>
            )}
            {draft.status === 'materialized' && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Teams are live</Text>
                <Text style={styles.bannerSub}>
                  Rosters are on Week {draft.weekNumber ?? '?'} — matchups and scoring run through the usual screens.
                </Text>
              </View>
            )}
            {draft.status === 'setup' && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Draft not started</Text>
                <Text style={styles.bannerSub}>
                  {isAdmin
                    ? 'Prune the pool if needed, then start the draft.'
                    : 'Waiting on the commissioner to start the draft.'}
                </Text>
              </View>
            )}

            {/* Rosters */}
            <Text style={styles.sectionHeader}>TEAMS</Text>
            {draft.rosters.map(team => (
              <View key={team.id} style={styles.card}>
                <View style={styles.teamHead}>
                  <Text style={styles.teamSeed}>SEED {team.seed}</Text>
                  <Text style={styles.teamCaptain}>{team.name}</Text>
                  {draft.onClock?.playerId === team.playerId && <Text style={styles.onClockDot}>● picking</Text>}
                </View>
                <Text style={styles.rosterLine}>C   {team.name}</Text>
                {team.picks.map(p => (
                  <Text key={p.id} style={styles.rosterLine}>
                    {p.pickNumber}   {p.pickedName}
                  </Text>
                ))}
                {team.picks.length === 0 && <Text style={styles.muted}>No picks yet</Text>}
              </View>
            ))}

            {/* Pool */}
            {draft.status !== 'materialized' && (
              <>
                <Text style={styles.sectionHeader}>
                  {draft.status === 'setup'
                    ? `DRAFT POOL (${draft.pool.length})`
                    : `AVAILABLE (${draft.remaining.length})`}
                </Text>
                <View style={styles.card}>
                  {(draft.status === 'setup' ? draft.pool : draft.remaining).map(e => (
                    <TouchableOpacity
                      key={e.id}
                      style={styles.row}
                      disabled={draft.status === 'drafting' ? !canPick : !(isAdmin && draft.status === 'setup')}
                      onPress={() => {
                        if (draft.status === 'drafting' && canPick) {
                          setConfirmPick({ playerId: e.playerId, name: e.name })
                        } else if (draft.status === 'setup' && isAdmin) {
                          run(() => playoffDrafts.removeFromPool(e.id), `${e.name} removed from pool`)
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.rowRank}>#{rankByPlayer.get(e.playerId) ?? '—'}</Text>
                      <Text style={styles.rowName}>{e.name}</Text>
                      {draft.status === 'drafting' && canPick && <Text style={styles.rowAction}>DRAFT</Text>}
                      {draft.status === 'setup' && isAdmin && <Text style={styles.rowRemove}>✕</Text>}
                    </TouchableOpacity>
                  ))}
                  {(draft.status === 'setup' ? draft.pool : draft.remaining).length === 0 && (
                    <Text style={styles.muted}>Pool is empty.</Text>
                  )}
                </View>
              </>
            )}

            {/* Admin controls */}
            {isAdmin && (
              <>
                <Text style={styles.sectionHeader}>COMMISSIONER</Text>
                <View style={styles.adminRow}>
                  {draft.status === 'setup' && (
                    <Button
                      label="Start draft"
                      onPress={() => run(() => playoffDrafts.update(draft.id, { status: 'drafting' }), 'Draft is live')}
                      loading={saving}
                    />
                  )}
                  {(draft.status === 'drafting' || draft.status === 'completed') && (
                    <Button
                      label="Undo last pick"
                      variant="outline"
                      onPress={() => run(() => playoffDrafts.undoPick(draft.id), 'Pick undone')}
                      loading={saving}
                      disabled={draft.picks.length === 0}
                    />
                  )}
                  {draft.status === 'completed' && (
                    <Button label="Create teams" onPress={() => setConfirmMaterialize(true)} />
                  )}
                  <Button
                    label="Reset draft"
                    variant="outline"
                    tone="danger"
                    onPress={() => setConfirmReset(true)}
                  />
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {confirmPick && draft && (
        <ConfirmActionSheet
          title={`Draft ${confirmPick.name}?`}
          subtitle={
            myTurn
              ? `Pick ${draft.picks.length + 1} — your pick`
              : `Pick ${draft.picks.length + 1} — on behalf of ${draft.onClock?.name ?? 'the captain'}`
          }
          confirmLabel="Draft player"
          action={() => playoffDrafts.makePick(draft.id, confirmPick.playerId)}
          successMessage={`${confirmPick.name} drafted`}
          onClose={() => setConfirmPick(null)}
          onDone={reload}
        >
          <Text style={styles.sheetBody}>
            {confirmPick.name} joins {myTurn ? 'your team' : `${draft.onClock?.name ?? 'the captain'}'s team`}. Picks
            can only be undone by the commissioner.
          </Text>
        </ConfirmActionSheet>
      )}

      {confirmReset && draft && (
        <ConfirmActionSheet
          title="Reset the draft?"
          confirmLabel="Reset draft"
          confirmVariant="danger"
          action={() => playoffDrafts.reset(draft.id)}
          successMessage="Draft reset"
          onClose={() => setConfirmReset(false)}
          onDone={reload}
        >
          <Text style={styles.sheetBody}>
            Deletes the draft, its captains, pool, and all {draft.picks.length} picks
            {draft.status === 'materialized'
              ? `, and removes the created teams (and any of their scores) from Week ${draft.weekNumber ?? '?'}`
              : ''}
            . Set up a fresh draft afterwards.
          </Text>
        </ConfirmActionSheet>
      )}

      {confirmMaterialize && draft && (
        <ConfirmActionSheet
          title="Create playoff teams?"
          confirmLabel="Create teams"
          action={materializeAndSchedule}
          successMessage="Playoff teams created"
          onClose={() => setConfirmMaterialize(false)}
          onDone={reload}
        >
          <Text style={styles.sheetBody}>
            Writes the drafted rosters as real teams on Week {draft.weekNumber ?? '?'} (captain in slot 1, picks in
            order) with the standard game schedule. Matchups and scoring then run through the usual week screens.
          </Text>
        </ConfirmActionSheet>
      )}

      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 14,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    marginBottom: 10,
  },

  banner: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border2,
    padding: 14,
    marginTop: 4,
  },
  bannerMyTurn: { borderColor: colors.accent },
  bannerText: {
    fontFamily: fonts.barlowSemiBold,
    fontSize: 16,
    color: colors.text,
  },
  bannerTextMyTurn: { color: colors.accent },
  bannerSub: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 3,
  },

  fieldLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  fieldGap: { marginTop: 16 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  rowRank: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted2,
    width: 32,
  },
  rowName: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  rowNameSelected: { color: colors.accent },
  rowCheck: {
    fontFamily: fonts.barlowSemiBold,
    fontSize: 15,
    color: colors.accent,
  },
  rowAction: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 1,
  },
  rowRemove: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.danger,
  },

  teamHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  teamSeed: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
  },
  teamCaptain: {
    fontFamily: fonts.barlowSemiBold,
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  onClockDot: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
  },
  rosterLine: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 3,
  },

  adminRow: { gap: 8, marginBottom: 10 },

  muted: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 6,
  },

  sheetBody: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
})
