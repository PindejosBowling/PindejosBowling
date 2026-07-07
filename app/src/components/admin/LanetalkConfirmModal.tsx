import { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useUiStore } from '../../stores/uiStore'
import { betMarkets, lanetalkImports, scores } from '../../utils/supabase/db'
import { gameStats } from '../../data/lanetalk/stats'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

interface Props {
  weekId: string
  weekTitle: string
  // The week's unsettled LaneTalk prop markets (id, title, subject_player_id,
  // game_number, params) — drives the informational coverage preview only; the
  // RPC recomputes data coverage authoritatively inside its transaction.
  markets: any[]
  onClose: () => void
  // Reload after a successful settle (run before onClose).
  onDone: () => void
}

// "Confirm LaneTalk Data" — settles the week's stat props off the imported
// official games via ONE atomic, idempotent RPC (settle_lanetalk_props_for_week,
// pattern: AdminArchiveModal — summary, warning box, armed second action).
// Built on BottomSheet directly (not ConfirmActionSheet): two settle actions
// plus the armed void two-step don't fit the single-action contract.
//
//  • Settle Available: settles every market whose data landed; the rest stay
//    pending, so the flow is safely re-runnable after late imports.
//  • Settle + Void Missing (armed): also DELETEs markets with no data — the
//    delete-refund rail returns every touched bet's stake whole. Refunded bets
//    are removed rather than kept as `void` records.
export default function LanetalkConfirmModal({ weekId, weekTitle, markets, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)
  const [voidArmed, setVoidArmed] = useState(false)

  // Coverage preview inputs: the week's official imports + scored-game counts.
  const [previewLoading, setPreviewLoading] = useState(true)
  const [officialImports, setOfficialImports] = useState<any[]>([])
  const [scoreRows, setScoreRows] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      lanetalkImports.listOfficialByWeek(weekId),
      scores.listByWeekWithGames(weekId),
    ]).then(([importsRes, scoresRes]) => {
      if (cancelled) return
      setOfficialImports(importsRes.data ?? [])
      setScoreRows(scoresRes.data ?? [])
      setPreviewLoading(false)
    })
    return () => { cancelled = true }
  }, [weekId])

  // Client-side mirror of the RPC's coverage rules (informational only):
  // game scope → an official import for (player, game) with frames; night
  // scope → official-game count ≥ scored-game count (never half a night).
  const { ready, missing } = useMemo(() => {
    const importsWithFrames = officialImports.filter(
      r => gameStats({ frames: r.payload?.frames ?? [] }) != null,
    )
    const gameKeys = new Set(importsWithFrames.map(r => `${r.player_id}|${r.game_number}`))
    const officialCount = new Map<string, number>()
    for (const r of importsWithFrames) {
      officialCount.set(r.player_id, (officialCount.get(r.player_id) ?? 0) + 1)
    }
    const scoredCount = new Map<string, number>()
    for (const s of scoreRows) {
      const pid = s.team_slots?.player_id
      if (pid) scoredCount.set(pid, (scoredCount.get(pid) ?? 0) + 1)
    }
    const ready: any[] = []
    const missing: any[] = []
    for (const m of markets) {
      const hasData = m.game_number != null
        ? gameKeys.has(`${m.subject_player_id}|${m.game_number}`)
        : (officialCount.get(m.subject_player_id) ?? 0) > 0 &&
          (officialCount.get(m.subject_player_id) ?? 0) >= (scoredCount.get(m.subject_player_id) ?? 0)
      ;(hasData ? ready : missing).push(m)
    }
    return { ready, missing }
  }, [markets, officialImports, scoreRows])

  async function settle(voidMissing: boolean) {
    setSaving(true)
    try {
      const { data, error } = await betMarkets.settleLanetalkProps(weekId, voidMissing)
      if (error) { showToast(error.message, 'error'); return }
      const row: any = Array.isArray(data) ? data[0] : data
      showToast(
        `Stat props: ${row?.settled ?? 0} settled · ${row?.voided ?? 0} refunded · ${row?.left_pending ?? 0} left pending`,
        'success',
      )
      onDone()
      onClose()
    } catch {
      showToast('Failed to settle stat props', 'error')
    } finally {
      setSaving(false)
    }
  }

  function onVoidPress() {
    // Armed two-step: the first tap reveals the warning, the second executes.
    if (!voidArmed) { setVoidArmed(true); return }
    settle(true)
  }

  return (
    <BottomSheet
      title="Confirm LaneTalk Data?"
      onClose={onClose}
      busy={saving}
      footer={
        <View style={styles.btnCol}>
          <Button
            label="Settle Available"
            onPress={() => settle(false)}
            loading={saving && !voidArmed}
            disabled={saving}
            fullWidth
          />
          {missing.length > 0 && !previewLoading && (
            <Button
              label={voidArmed ? 'Confirm: Settle + Void Missing' : 'Settle + Void Missing'}
              variant="danger"
              onPress={onVoidPress}
              loading={saving && voidArmed}
              disabled={saving}
              fullWidth
            />
          )}
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </View>
      }
    >
      <Text style={styles.body}>
        Settles {weekTitle}'s stat props from the imported official games. Values are
        derived server-side; this preview is informational.
      </Text>

      {previewLoading ? (
        <Text style={styles.previewLoading}>Checking data coverage…</Text>
      ) : (
        <View style={styles.previewBox}>
          <Text style={styles.previewLine}>
            {ready.length} market{ready.length === 1 ? '' : 's'} with data ·{' '}
            {missing.length} missing data
          </Text>
          {missing.slice(0, 6).map(m => (
            <Text key={m.id} style={styles.previewMissing}>· {m.title}</Text>
          ))}
          {missing.length > 6 && (
            <Text style={styles.previewMissing}>· …and {missing.length - 6} more</Text>
          )}
        </View>
      )}

      {voidArmed && (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            Voiding deletes the {missing.length} missing-data market{missing.length === 1 ? '' : 's'} and
            refunds every bet touching them in full.
          </Text>
          <Text style={styles.warnSub}>
            Prefer Settle Available if more imports are still coming — it leaves them
            pending and can be re-run.
          </Text>
        </View>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  body: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 14,
  },
  previewLoading: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
  previewBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  previewLine: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  previewMissing: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  warnBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
    marginTop: 14,
  },
  warnText: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 17,
  },
  warnSub: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
  },
  btnCol: { gap: 10, marginTop: 18 },
})
