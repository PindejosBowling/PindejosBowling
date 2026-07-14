import { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useUiStore } from '../../stores/uiStore'
import { archives } from '../../utils/supabase/db'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

interface Props {
  weekId: string
  weekTitle: string
  onClose: () => void
  // Reload after a successful settle (run before onClose).
  onDone: () => void
}

interface WouldVoid {
  market_id: string
  market_type: string
  title: string
  reason: string
}
interface Preview {
  settleable: number
  missing_count: number
  would_void: WouldVoid[]
}

// "Settle Week" — the next-day clock. Settles ALL money for an advanced (locked)
// week: pincome, bets, LaneTalk props, loans, PvP, unified House P/L. Mounted
// while the week is advanced-but-unsettled (is_archived && settled_at == null).
//
// The would-void warning is authoritative: preview_settle_week runs the exact
// coverage predicates settle_week uses, server-side (no client mirror).
//
//  • Settle Available: settles every market whose data landed; LaneTalk props
//    still lacking imports stay pending, so it is safely re-runnable after late
//    imports. Fails loudly if a score-derived market has no gradable outcome.
//  • Settle + Void Missing (armed): also delete-refunds every would-void market
//    and force-voids any bet that would otherwise remain pending.
export default function AdminSettleModal({ weekId, weekTitle, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)
  const [voidArmed, setVoidArmed] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    let cancelled = false
    archives.previewSettleWeek(weekId).then(({ data, error }) => {
      if (cancelled) return
      if (!error && data) setPreview(data as unknown as Preview)
      setPreviewLoading(false)
    })
    return () => { cancelled = true }
  }, [weekId])

  const missing = preview?.would_void ?? []

  async function settle(voidMissing: boolean) {
    setSaving(true)
    try {
      const { data, error } = await archives.settleWeek(weekId, voidMissing, voidMissing)
      if (error) { showToast(error.message, 'error'); return }
      const row: any = data
      const net = row?.house_net ?? 0
      showToast(
        `${weekTitle} settled · ${row?.settled ?? 0} props · ${row?.voided ?? 0} voided · ` +
        `${row?.left_pending ?? 0} pending · House ${net >= 0 ? '+' : ''}${Number(net).toLocaleString()}`,
        'success',
      )
      onDone()
      onClose()
    } catch {
      showToast('Failed to settle the week', 'error')
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
      title="Settle Week?"
      onClose={onClose}
      busy={saving}
      footer={
        <View style={styles.btnCol}>
          <Button
            label="Settle Available"
            onPress={() => settle(false)}
            loading={saving && !voidArmed}
            disabled={saving || previewLoading}
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
        Settles {weekTitle}'s money — pincome, bets, LaneTalk props, loans, PvP and the
        House's weekly result. Values are derived server-side.
      </Text>

      {previewLoading ? (
        <Text style={styles.previewLoading}>Checking data coverage…</Text>
      ) : (
        <View style={styles.previewBox}>
          <Text style={styles.previewLine}>
            {preview?.settleable ?? 0} market{(preview?.settleable ?? 0) === 1 ? '' : 's'} ready ·{' '}
            {missing.length} missing data
          </Text>
          {missing.slice(0, 6).map(m => (
            <Text key={m.market_id} style={styles.previewMissing}>· {m.title} — {m.reason}</Text>
          ))}
          {missing.length > 6 && (
            <Text style={styles.previewMissing}>· …and {missing.length - 6} more</Text>
          )}
        </View>
      )}

      {voidArmed && (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            Voiding delete-refunds the {missing.length} missing-data market{missing.length === 1 ? '' : 's'} and
            force-voids any bet that would otherwise stay pending.
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
