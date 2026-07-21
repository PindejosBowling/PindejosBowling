import { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import { STAT_LABELS } from '../../hooks/usePinsinoData'
import { useAuthStore } from '../../stores/authStore'
import { useBetSlip } from './BetSlipProvider'
import { betMarkets } from '../../utils/supabase/db'

interface Props {
  // Compose a combo line (member set × stat × scope) and ADD IT TO THE BET
  // SLIP as a staged combo spec — no market exists yet, and no bet is placed
  // here. The slip places it (compose_combo_bet creates the market atomically
  // with the bet), so a combo coexists with regular picks and other combos in
  // one parlay. Mount conditionally.
  weekId: string
  seasonId: string
  // The week's schedule game numbers (board-derived; [1, 2] before teams —
  // mirrors the compose RPC's pre-teams default).
  gameNumbers: number[]
  // Selectable member pool: the week's RSVP'd-in players (the RPC re-enforces).
  members: { playerId: string; name: string }[]
  onClose: () => void
}

const STAT_OPTIONS = (['strikes', 'spares', 'clean_frames', 'total_pins'] as const).map(k => ({
  key: k as string,
  label: STAT_LABELS[k],
}))

export default function ComboComposerSheet({
  weekId, seasonId, gameNumbers, members, onClose,
}: Props) {
  const playerId = useAuthStore(s => s.playerId)
  const { slipCombos, stageCombo, openSlip } = useBetSlip()

  const [stat, setStat] = useState<string>('strikes')
  // 'night' or a schedule game number as a string.
  const [scope, setScope] = useState<string>('night')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const scopeOptions = useMemo(
    () => [
      { key: 'night', label: 'Night' },
      ...gameNumbers.map(n => ({ key: String(n), label: `Game ${n}` })),
    ],
    [gameNumbers]
  )

  const memberIds = useMemo(() => [...selected].sort(), [selected])
  const gameNumber = scope === 'night' ? null : Number(scope)
  const nGames = scope === 'night' ? Math.max(gameNumbers.length, 1) : 1

  // The slip staging key = the combo's canonical identity, so staging the same
  // combo twice toggles (and two different combos coexist).
  const comboKey = `${stat}|${scope}|${memberIds.join(',')}`
  const alreadyStaged = slipCombos.some(c => c.key === comboKey)

  // Live line preview — the number the market will be seeded with
  // (combo_seed_line is the same function the compose RPC uses). Display-only:
  // the RPC re-seeds at placement. Debounced per selection.
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

  function toggleMember(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addToSlip() {
    if (memberIds.length < 2) return
    const nameById = new Map(members.map(m => [m.playerId, m.name]))
    stageCombo({
      key: comboKey,
      weekId,
      memberIds,
      memberNames: memberIds.map(id => nameById.get(id) ?? '—'),
      stat,
      scope: scope === 'night' ? 'night' : 'game',
      gameNumber,
      line: previewLine,
    })
    onClose()
    openSlip()
  }

  return (
    <BottomSheet
      title="Build a Combo"
      subtitle="Combine players into one line — their stats sum against it"
      onClose={onClose}
      footer={
        <>
          <Button
            label={alreadyStaged ? 'Remove from Bet Slip' : 'Add to Bet Slip'}
            size="lg"
            onPress={addToSlip}
            disabled={memberIds.length < 2}
            style={styles.submitBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
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

      {/* The seeded line, straight from the server (re-derived at placement). */}
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

      <Text style={styles.slipHint}>
        Your combo goes to the bet slip — set the stake there, and parlay it
        with other lines or more combos if you like.
      </Text>

      <TermsBlock terms={TERMS.combo} />
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

  slipHint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 17 },

  submitBtn: { marginTop: 14 },
})
