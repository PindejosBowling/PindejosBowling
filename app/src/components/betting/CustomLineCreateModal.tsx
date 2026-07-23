import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import PlayerPickerModal, { type PlayerPickerItem } from '../ui/PlayerPickerModal'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { customLines, players, weeks } from '../../utils/supabase/db'
import { STAT_LABELS, type CustomLegSpec } from '../../hooks/usePinsinoData'
import type { Json } from '../../utils/supabase/database.types'

const MAX_TITLE_LEN = 80
const MAX_LEGS = 6
// The two official games per night. (Resolution follows the actual schedule,
// so an extra game would still resolve — the builder just doesn't offer it.)
const GAME_NUMBERS = [1, 2]

type Scope = 'this_week' | 'pick_weeks' | 'permanent'

// Only player-stat legs are authorable (the team family — moneyline win /
// team_prop stats — retired with team-anchored market generation; combos
// replaced it. Legacy team legs still RENDER via legSummary, but new ones
// can't be authored — they'd never resolve). 'score' is a pseudo-stat mapping
// to the over_under kind; the rest map to prop with that params.stat.
// first_ball_avg is retired — not offered. All picks are over (the board's
// no-unders policy applies to specials too).
const PLAYER_STATS = ['score', 'strikes', 'spares', 'clean_frames']
const CHIP_LABELS: Record<string, string> = { score: 'Score', ...STAT_LABELS }

interface Props {
  // Mounted conditionally so it resets between opens. Doubles as the Edit sheet
  // when `initial` (a raw custom_lines row) is passed — submit updates in place.
  // Edits never touch bets already placed (they hold concrete selections).
  currentWeekId: string | null
  seasonId: string | null
  initial?: any | null
  onClose: () => void
  onDone: () => void
}

// Derive the scope toggle position from a row's week_ids (null = permanent;
// exactly the current week = "this week"; anything else = picked weeks).
function scopeOf(weekIds: string[] | null, currentWeekId: string | null): Scope {
  if (weekIds == null) return 'permanent'
  if (currentWeekId != null && weekIds.length === 1 && weekIds[0] === currentWeekId) return 'this_week'
  return 'pick_weeks'
}

export default function CustomLineCreateModal({ currentWeekId, seasonId, initial, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const myPlayerId = useAuthStore(s => s.playerId)

  const [title, setTitle] = useState<string>(initial?.title ?? '')
  const [description, setDescription] = useState<string>(initial?.description ?? '')
  const [category, setCategory] = useState<'default' | 'special'>(initial?.category ?? 'default')
  const [scope, setScope] = useState<Scope>(scopeOf(initial?.week_ids ?? null, currentWeekId))
  const [selectedWeekIds, setSelectedWeekIds] = useState<string[]>(initial?.week_ids ?? [])
  const [legs, setLegs] = useState<CustomLegSpec[]>(Array.isArray(initial?.legs) ? initial.legs : [])
  const [saving, setSaving] = useState(false)

  // Add-leg sub-form, progressive: stat chips, scope, game, subject. Subject
  // is either a specific player or THE BETTOR (self-referential: "whoever
  // takes this bet" — resolves per-taker, e.g. "you beat your over").
  const [legStat, setLegStat] = useState<string>('score')
  // Game legs bind to a game; night legs settle over the whole night (one
  // null-game market).
  const [legScope, setLegScope] = useState<'game' | 'night'>('game')
  const [legWho, setLegWho] = useState<'player' | 'bettor'>('player')
  const [legPlayer, setLegPlayer] = useState<PlayerPickerItem | null>(null)
  // A specific game, or two relative modes:
  //  • 'both' — builder sugar: stages one leg per official game, all in ONE
  //    bet ("you beat your over in both games" — a week-level cross-game bundle).
  //  • 'each' (stored as game_number null) — the special materializes once per
  //    game that week, each instance binding this leg to that game.
  const [legGame, setLegGame] = useState<number | 'both' | 'each'>(1)
  const [pickerOpen, setPickerOpen] = useState(false)

  const legKind: CustomLegSpec['kind'] = legStat === 'score' ? 'over_under' : 'prop'

  // Season roster (leg subjects/anchors) + season weeks (the Pick Weeks chips).
  const [seasonPlayers, setSeasonPlayers] = useState<PlayerPickerItem[]>([])
  const [seasonWeeks, setSeasonWeeks] = useState<{ id: string; week_number: number; is_archived: boolean }[]>([])
  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    ;(async () => {
      const [{ data: ps }, { data: ws }] = await Promise.all([
        players.listBySeason(seasonId),
        weeks.listBySeason(seasonId),
      ])
      if (cancelled) return
      setSeasonPlayers((ps ?? []).map((p: any) => ({ id: p.id, name: p.name })))
      setSeasonWeeks(ws ?? [])
    })()
    return () => { cancelled = true }
  }, [seasonId])

  const nameById = useMemo(
    () => new Map(seasonPlayers.map(p => [p.id, p.name])),
    [seasonPlayers],
  )

  // Renders new AND legacy legs: legacy rows have no scope/stat (→ game scope,
  // no stat label) and may carry an 'under' pick — shown as stored.
  function legSummary(leg: CustomLegSpec): string {
    const isTeam = leg.kind === 'moneyline' || leg.kind === 'team_prop'
    const who = leg.player_id == null ? 'The Bettor' : (nameById.get(leg.player_id) ?? '—')
    const name = isTeam ? `${who}'s Team` : who
    const statLabel = leg.stat ? ` ${(STAT_LABELS[leg.stat] ?? leg.stat).toUpperCase()}` : ''
    const where = (leg.scope ?? 'game') === 'night'
      ? 'NIGHT'
      : leg.game_number == null ? 'EACH GAME' : `G${leg.game_number}`
    return `${name} · ${leg.pick.toUpperCase()}${statLabel} · ${where}`
  }

  function addLeg() {
    if (legWho === 'player' && !legPlayer) { showToast('Pick a player for the leg', 'error'); return }
    // Night legs resolve once against the null-game night market. At game
    // scope: BOTH stages one leg per official game (a cross-game bundle in one
    // bet); EACH stores null (per-game offering); a number is just that game.
    const games: (number | null)[] =
      legScope === 'night' ? [null] :
      legGame === 'both' ? GAME_NUMBERS : legGame === 'each' ? [null] : [legGame]
    // Only real stat kinds carry params.stat; 'score'/'win' are the kind itself.
    const stat = legKind === 'prop' ? legStat : undefined
    const newLegs: CustomLegSpec[] = games.map(g => ({
      kind: legKind,
      // null = the bettor (self-referential) — resolved per-taker on the board.
      player_id: legWho === 'bettor' ? null : legPlayer!.id,
      ...(stat ? { stat } : {}),
      // Always written explicitly so new rows are self-describing (legacy rows
      // lack it and read as 'game').
      scope: legScope,
      game_number: g,
      // Over-only creation: no side ever bets against a subject, so anti-tank
      // can never block a taker.
      pick: 'over',
    }))
    if (legs.length + newLegs.length > MAX_LEGS) {
      showToast(`Max ${MAX_LEGS} legs`, 'error')
      return
    }
    // Same (kind, subject, stat, scope) collides on the same game — and an
    // EACH-games leg collides with any game for that tuple (its instances would
    // double up). Night legs only collide with night legs of the same tuple;
    // a game leg and a night leg never share a market.
    const overlaps = newLegs.some(leg => legs.some(l => {
      if (l.kind !== leg.kind || l.player_id !== leg.player_id) return false
      if ((l.stat ?? '') !== (leg.stat ?? '')) return false
      const a = l.scope ?? 'game'
      const b = leg.scope ?? 'game'
      if (a !== b) return false
      if (a === 'night') return true
      return l.game_number === leg.game_number || l.game_number == null || leg.game_number == null
    }))
    if (overlaps) {
      showToast('That leg overlaps one already on the line', 'error')
      return
    }
    setLegs(prev => [...prev, ...newLegs])
    setLegPlayer(null)
  }

  const error = useMemo<string | null>(() => {
    if (!title.trim()) return 'Add a title'
    if (title.length > MAX_TITLE_LEN) return `Title must be ≤ ${MAX_TITLE_LEN} characters`
    if (legs.length === 0) return 'Add at least one leg'
    if (legs.length > MAX_LEGS) return `Max ${MAX_LEGS} legs`
    if (scope === 'pick_weeks' && selectedWeekIds.length === 0) return 'Pick at least one week'
    if (scope === 'this_week' && !currentWeekId) return 'No active week'
    return null
  }, [title, legs, scope, selectedWeekIds, currentWeekId])

  async function submit() {
    if (saving || error) return
    setSaving(true)
    try {
      const weekIds =
        scope === 'permanent' ? null :
        scope === 'this_week' ? [currentWeekId!] :
        selectedWeekIds
      const payload = {
        title: title.trim(),
        description: description.trim(),
        category,
        legs: legs as unknown as Json,
        week_ids: weekIds,
      }
      const { error: dbErr } = initial
        ? await customLines.update(initial.id, payload)
        : await customLines.create({ ...payload, created_by_player_id: myPlayerId })
      if (dbErr) { showToast(dbErr.message, 'error'); return }
      showToast(initial ? 'Special updated' : 'Special created', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to save special', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={initial ? 'Edit Special' : 'New Special'}
      subtitle="Players take it as one bet at the legs' combined odds · Edits never change placed bets"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label={initial ? 'Save Special' : 'Create Special'}
            size="lg"
            onPress={submit}
            loading={saving}
            disabled={!!error || saving}
            style={styles.submitBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <Text style={styles.label}>TITLE</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="The Garrett Special" placeholderTextColor={colors.muted2} maxLength={MAX_TITLE_LEN} />

      <Text style={styles.label}>DESCRIPTION</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="What the bettor is taking (shown on the board)."
        placeholderTextColor={colors.muted2}
        multiline
        maxLength={300}
      />

      <Text style={styles.label}>STYLE</Text>
      <ToggleGroup
        options={[{ key: 'default', label: 'Standard' }, { key: 'special', label: 'Special (gold)' }]}
        value={category}
        onChange={(c: 'default' | 'special') => setCategory(c)}
      />

      <Text style={styles.label}>OFFERED</Text>
      <ToggleGroup
        options={[
          { key: 'this_week', label: 'This Week' },
          { key: 'pick_weeks', label: 'Pick Weeks' },
          { key: 'permanent', label: 'Every Week' },
        ]}
        value={scope}
        onChange={(s: Scope) => setScope(s)}
      />
      {scope === 'pick_weeks' && (
        <View style={styles.chipWrap}>
          {seasonWeeks.filter(w => !w.is_archived || selectedWeekIds.includes(w.id)).map(w => {
            const on = selectedWeekIds.includes(w.id)
            return (
              <TouchableOpacity
                key={w.id}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setSelectedWeekIds(prev => on ? prev.filter(id => id !== w.id) : [...prev, w.id])}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>WK {w.week_number}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
      {scope === 'permanent' && (
        <Text style={styles.hint}>Offered every week while enabled. Weeks where a leg can't resolve (subject not bowling) hide it automatically.</Text>
      )}

      <Text style={styles.label}>LEGS ({legs.length})</Text>
      {legs.map((leg, i) => (
        <View key={`${leg.kind}-${leg.player_id}-${leg.stat ?? ''}-${leg.scope ?? 'game'}-${leg.game_number}`} style={styles.legRow}>
          <Text style={styles.legText}>{legSummary(leg)}</Text>
          <TouchableOpacity onPress={() => setLegs(prev => prev.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.legRemove}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Add-leg sub-form: player-stat chips — the score kind lives as the
          first chip. (The Team Stat / Win family is retired with team-anchored
          market generation — combos replaced it. Legacy team legs still render
          in the list above but new ones can't be authored: they'd never
          resolve once team_prop/moneyline markets stop generating.) */}
      <View style={styles.addLegCard}>
        <View style={styles.chipWrapForm}>
          {PLAYER_STATS.map(s => (
            <TouchableOpacity key={s} style={[styles.chip, legStat === s && styles.chipOn]} onPress={() => setLegStat(s)} activeOpacity={0.7}>
              <Text style={[styles.chipText, legStat === s && styles.chipTextOn]}>
                {(CHIP_LABELS[s] ?? s).toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ToggleGroup
          options={[{ key: 'player', label: 'Specific Player' }, { key: 'bettor', label: 'Whoever Takes It' }]}
          value={legWho}
          onChange={(w: 'player' | 'bettor') => setLegWho(w)}
        />
        {legWho === 'player' ? (
          <TouchableOpacity style={styles.playerBtn} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
            <Text style={[styles.playerBtnText, !legPlayer && { color: colors.muted2 }]}>
              {legPlayer ? legPlayer.name : 'Player'}
            </Text>
            <Text style={styles.playerBtnChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>
            The leg is about the taker themself — "you beat your over". Hidden
            from players it can't resolve for.
          </Text>
        )}
        <ToggleGroup
          options={[{ key: 'game', label: 'Per Game' }, { key: 'night', label: 'Whole Night' }]}
          value={legScope}
          onChange={(s: 'game' | 'night') => setLegScope(s)}
        />
        {legScope === 'game' && (
          <View style={styles.chipWrapForm}>
            {GAME_NUMBERS.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, legGame === g && styles.chipOn]} onPress={() => setLegGame(g)} activeOpacity={0.7}>
                <Text style={[styles.chipText, legGame === g && styles.chipTextOn]}>G{g}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.chip, legGame === 'both' && styles.chipOn]} onPress={() => setLegGame('both')} activeOpacity={0.7}>
              <Text style={[styles.chipText, legGame === 'both' && styles.chipTextOn]}>BOTH</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, legGame === 'each' && styles.chipOn]} onPress={() => setLegGame('each')} activeOpacity={0.7}>
              <Text style={[styles.chipText, legGame === 'each' && styles.chipTextOn]}>EACH</Text>
            </TouchableOpacity>
          </View>
        )}
        {legScope === 'night' && (
          <Text style={styles.hint}>
            Whole night: one leg settled over the night's total — no single game. Placed in the WEEKLY section.
          </Text>
        )}
        {legScope === 'game' && legGame === 'both' && (
          <Text style={styles.hint}>
            Both games: adds a leg for Game 1 and Game 2 in ONE bet — every leg must hit ("…in both games"). A week-level bundle.
          </Text>
        )}
        {legScope === 'game' && legGame === 'each' && (
          <Text style={styles.hint}>
            Each game: the special is offered once per game that week — this leg binds to each game in turn ("…in this game").
          </Text>
        )}
        <Button variant="outline" label="Add Leg" onPress={addLeg} disabled={legs.length >= MAX_LEGS} />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <PlayerPickerModal
        visible={pickerOpen}
        items={seasonPlayers}
        onSelectItem={p => { setLegPlayer(p); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)}
        title="Select Player"
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  hint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  // Chip rows inside the add-leg card: wrap instead of overflowing (the team
  // family has five chips); the card's own gap handles vertical spacing.
  chipWrapForm: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border2, backgroundColor: colors.surface2,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  chipText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  chipTextOn: { color: colors.accent },
  legRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  legText: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.text, letterSpacing: 0.3 },
  legRemove: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.danger },
  addLegCard: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    padding: 12, marginTop: 10, gap: 10,
  },
  playerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  playerBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  playerBtnChevron: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.muted },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 12 },
  submitBtn: { marginTop: 14 },
})
