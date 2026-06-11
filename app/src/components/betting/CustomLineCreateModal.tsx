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
import type { CustomLegSpec } from '../../hooks/usePinsinoData'
import type { Json } from '../../utils/supabase/database.types'

const MAX_TITLE_LEN = 80
const MAX_LEGS = 6
const GAME_NUMBERS = [1, 2, 3]

type Scope = 'this_week' | 'pick_weeks' | 'permanent'
type LegKind = CustomLegSpec['kind']

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

  // Add-leg sub-form. Subject is either a specific player or THE BETTOR
  // (self-referential: "whoever takes this bet" — resolves per-taker, e.g.
  // "you beat your over" / "your team wins the game").
  const [legKind, setLegKind] = useState<LegKind>('over_under')
  const [legWho, setLegWho] = useState<'player' | 'bettor'>('player')
  const [legPlayer, setLegPlayer] = useState<PlayerPickerItem | null>(null)
  const [legGame, setLegGame] = useState(1)
  const [legPick, setLegPick] = useState<'over' | 'under'>('over')
  const [pickerOpen, setPickerOpen] = useState(false)

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

  function legSummary(leg: CustomLegSpec): string {
    const name = leg.player_id == null ? 'The Bettor' : (nameById.get(leg.player_id) ?? '—')
    return leg.kind === 'over_under'
      ? `${name} · ${leg.pick.toUpperCase()} · G${leg.game_number}`
      : `${name}'s Team · WIN · G${leg.game_number}`
  }

  function addLeg() {
    if (legWho === 'player' && !legPlayer) { showToast('Pick a player for the leg', 'error'); return }
    const leg: CustomLegSpec = {
      kind: legKind,
      // null = the bettor (self-referential) — resolved per-taker on the board.
      player_id: legWho === 'bettor' ? null : legPlayer!.id,
      game_number: legGame,
      // A self 'under' would bet against the taker's own performance — always
      // blocked by anti-tank, so self O/U legs are over-only.
      pick: legKind === 'moneyline' ? 'win' : legWho === 'bettor' ? 'over' : legPick,
    }
    if (legs.some(l => l.kind === leg.kind && l.player_id === leg.player_id && l.game_number === leg.game_number)) {
      showToast('That leg is already on the line', 'error')
      return
    }
    setLegs(prev => [...prev, leg])
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
      bodyMaxHeight={460}
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
        <View key={`${leg.kind}-${leg.player_id}-${leg.game_number}`} style={styles.legRow}>
          <Text style={styles.legText}>{legSummary(leg)}</Text>
          <TouchableOpacity onPress={() => setLegs(prev => prev.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.legRemove}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Add-leg sub-form */}
      <View style={styles.addLegCard}>
        <ToggleGroup
          options={[{ key: 'over_under', label: 'Player O/U' }, { key: 'moneyline', label: 'Team Win' }]}
          value={legKind}
          onChange={(k: LegKind) => setLegKind(k)}
        />
        <ToggleGroup
          options={[{ key: 'player', label: 'Specific Player' }, { key: 'bettor', label: 'Whoever Takes It' }]}
          value={legWho}
          onChange={(w: 'player' | 'bettor') => setLegWho(w)}
        />
        {legWho === 'player' ? (
          <TouchableOpacity style={styles.playerBtn} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
            <Text style={[styles.playerBtnText, !legPlayer && { color: colors.muted2 }]}>
              {legPlayer ? legPlayer.name : legKind === 'moneyline' ? 'Anchor player (their team wins)' : 'Player'}
            </Text>
            <Text style={styles.playerBtnChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>
            The leg is about the taker themself — {legKind === 'moneyline'
              ? '"your team wins the game". Only offered to players on a team that week.'
              : '"you beat your over". Self legs are over-only (an under would bet against yourself).'}
          </Text>
        )}
        <View style={styles.addLegRow}>
          <View style={styles.chipWrapInline}>
            {GAME_NUMBERS.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, legGame === g && styles.chipOn]} onPress={() => setLegGame(g)} activeOpacity={0.7}>
                <Text style={[styles.chipText, legGame === g && styles.chipTextOn]}>G{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {legKind === 'over_under' && legWho === 'player' && (
            <View style={styles.chipWrapInline}>
              {(['over', 'under'] as const).map(p => (
                <TouchableOpacity key={p} style={[styles.chip, legPick === p && styles.chipOn]} onPress={() => setLegPick(p)} activeOpacity={0.7}>
                  <Text style={[styles.chipText, legPick === p && styles.chipTextOn]}>{p.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        <Button variant="outline" label="Add Leg" onPress={addLeg} disabled={legs.length >= MAX_LEGS} />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <PlayerPickerModal
        visible={pickerOpen}
        items={seasonPlayers}
        onSelectItem={p => { setLegPlayer(p); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)}
        title={legKind === 'moneyline' ? 'Anchor Player' : 'Select Player'}
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
  chipWrapInline: { flexDirection: 'row', gap: 6 },
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
  addLegRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 12 },
  submitBtn: { marginTop: 14 },
})
