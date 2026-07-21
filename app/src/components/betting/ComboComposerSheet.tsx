import { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PinAmountInput from '../ui/PinAmountInput'
import ToggleGroup from '../ui/ToggleGroup'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import { STAT_LABELS } from '../../hooks/usePinsinoData'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { betMarkets, bets } from '../../utils/supabase/db'
import { formatPins } from '../../utils/formatting'

interface Props {
  // Compose a combo line (member set × stat × scope) and bet it in one action.
  // Mount conditionally.
  weekId: string
  seasonId: string
  balance: number
  // The week's schedule game numbers (board-derived; [1, 2] before teams —
  // mirrors the compose RPC's pre-teams default).
  gameNumbers: number[]
  // Selectable member pool: the week's RSVP'd-in players (the RPC re-enforces).
  members: { playerId: string; name: string }[]
  // Staged bet-slip selections, offered as parlay legs for the new combo.
  slipSelectionIds: string[]
  onClose: () => void
  // parlayed = the staged slip was consumed into the combo bet (clear it).
  onDone: (parlayed: boolean) => void
}

const STAT_OPTIONS = (['strikes', 'spares', 'clean_frames', 'total_pins'] as const).map(k => ({
  key: k as string,
  label: STAT_LABELS[k],
}))

export default function ComboComposerSheet({
  weekId, seasonId, balance, gameNumbers, members, slipSelectionIds, onClose, onDone,
}: Props) {
  const { showToast } = useUiStore()
  const playerId = useAuthStore(s => s.playerId)

  const [stat, setStat] = useState<string>('strikes')
  // 'night' or a schedule game number as a string.
  const [scope, setScope] = useState<string>('night')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [stakeText, setStakeText] = useState('')
  const [parlayWithSlip, setParlayWithSlip] = useState(false)
  const [saving, setSaving] = useState(false)

  const scopeOptions = useMemo(
    () => [
      { key: 'night', label: 'Night' },
      ...gameNumbers.map(n => ({ key: String(n), label: `Game ${n}` })),
    ],
    [gameNumbers]
  )

  const memberIds = useMemo(() => [...selected].sort(), [selected])
  const stake = Number(stakeText) || 0
  const nGames = scope === 'night' ? Math.max(gameNumbers.length, 1) : 1

  // Live line preview — the EXACT number the market will carry (combo_seed_line
  // is the same function the compose RPC seeds with). Debounced per selection.
  const [previewLine, setPreviewLine] = useState<number | null>(null)
  useEffect(() => {
    if (memberIds.length < 2) { setPreviewLine(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await betMarkets.previewComboLine(memberIds, stat, seasonId, nGames)
      if (!cancelled) setPreviewLine(data != null ? Number(data) : null)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [memberIds.join(','), stat, seasonId, nGames])

  const error = useMemo<string | null>(() => {
    if (memberIds.length < 2) return 'Pick at least two players'
    if (stake <= 0) return 'Enter your wager'
    if (stake < 10) return 'Minimum wager is 10 pins'
    if (stake > balance) return 'Wager exceeds your balance'
    return null
  }, [memberIds.length, stake, balance])

  function toggleMember(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const parlayLegs = parlayWithSlip ? slipSelectionIds : []
  const totalOdds = 2 * Math.pow(2, parlayLegs.length)

  async function submit() {
    if (saving || error) return
    setSaving(true)
    try {
      const { data, error: rpcErr } = await bets.composeCombo(
        weekId, memberIds, stat, scope === 'night' ? 'night' : 'game',
        scope === 'night' ? null : Number(scope), stake,
        parlayLegs.length > 0 ? parlayLegs : undefined,
      )
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      const deduped = (data as any)?.deduped === true
      showToast(deduped ? 'Joined the existing combo' : 'Combo placed', 'success')
      onDone(parlayLegs.length > 0)
      onClose()
    } catch {
      showToast('Failed to place the combo', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Build a Combo"
      subtitle="Combine players into one line — their stats sum against it"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label={error ? 'Compose & Bet' : `Bet ${formatPins(stake)} on Over ${previewLine != null ? previewLine.toFixed(1) : '…'}`}
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
      <Text style={styles.label}>STAT</Text>
      <ToggleGroup variant="pill" options={STAT_OPTIONS} value={stat} onChange={setStat} />

      <Text style={styles.label}>SCOPE</Text>
      <ToggleGroup variant="pill" options={scopeOptions} value={scope} onChange={setScope} />

      <Text style={styles.label}>PLAYERS (2+, RSVP'D IN)</Text>
      {members.length < 2 ? (
        <Text style={styles.emptyText}>Not enough players are RSVP'd in yet.</Text>
      ) : (
        <View style={styles.memberList}>
          {members.map((m, idx) => {
            const on = selected.has(m.playerId)
            return (
              <TouchableOpacity
                key={m.playerId}
                style={[styles.memberRow, idx === members.length - 1 && styles.memberRowLast]}
                onPress={() => toggleMember(m.playerId)}
                activeOpacity={0.7}
              >
                <Text style={[styles.memberName, on && styles.memberNameOn]}>
                  {m.name}{m.playerId === playerId ? ' (you)' : ''}
                </Text>
                <Text style={[styles.memberCheck, on && styles.memberCheckOn]}>{on ? '✓' : '+'}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}

      {/* The seeded line, straight from the server. */}
      <View style={styles.previewRow}>
        <Text style={styles.previewLabel}>THE LINE</Text>
        <Text style={styles.previewValue}>
          {memberIds.length < 2
            ? 'Pick players'
            : previewLine != null
              ? `Over ${previewLine.toFixed(1)} ${(STAT_LABELS[stat] ?? stat).toUpperCase()}`
              : '…'}
        </Text>
      </View>

      <Text style={styles.label}>YOUR WAGER</Text>
      <PinAmountInput variant="big" value={stakeText} onChangeText={setStakeText} placeholder="min 10" />

      {/* Parlay the fresh combo with the already-staged slip picks — one atomic
          multi-leg bet via the compose RPC's extra selections. */}
      {slipSelectionIds.length > 0 && (
        <TouchableOpacity
          style={styles.parlayRow}
          onPress={() => setParlayWithSlip(v => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.memberCheck, parlayWithSlip && styles.memberCheckOn]}>
            {parlayWithSlip ? '✓' : '+'}
          </Text>
          <View style={styles.parlayTextWrap}>
            <Text style={styles.parlayTitle}>
              Parlay with your slip ({slipSelectionIds.length} {slipSelectionIds.length === 1 ? 'leg' : 'legs'})
            </Text>
            <Text style={styles.parlayHint}>
              One ticket: this combo + your staged picks, all must hit · pays ×{totalOdds.toFixed(0)}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      <TermsBlock terms={TERMS.combo} />

      {error && (stake > 0 || memberIds.length > 0) && <Text style={styles.errorText}>{error}</Text>}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  emptyText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted },

  memberList: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm,
    borderWidth: 1, borderColor: colors.border2,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: colors.border2,
  },
  memberRowLast: { borderBottomWidth: 0 },
  memberName: { fontFamily: fonts.barlow, fontSize: 15, color: colors.muted },
  memberNameOn: { color: colors.text },
  memberCheck: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 16, color: colors.muted, width: 22, textAlign: 'center' },
  memberCheckOn: { color: colors.accent },

  previewRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 10, marginTop: 14,
  },
  previewLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  previewValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },

  parlayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 14,
  },
  parlayTextWrap: { flex: 1 },
  parlayTitle: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text },
  parlayHint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 2 },

  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 10 },
  submitBtn: { marginTop: 14 },
})
