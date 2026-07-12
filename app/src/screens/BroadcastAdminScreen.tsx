import { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import Toast from '../components/ui/Toast'
import Button from '../components/ui/Button'
import ToggleGroup from '../components/ui/ToggleGroup'
import EmptyCard from '../components/ui/EmptyCard'
import PlayerPickerModal from '../components/ui/PlayerPickerModal'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { broadcasts } from '../utils/supabase/db'
import { useBroadcastAdminData, BroadcastRow } from '../hooks/useBroadcastAdminData'
import { useDatePicker } from '../hooks/useDatePicker'

// Broadcasts — the admin push composer + history (Push Broadcasts,
// context/push-broadcasts.md). Compose: category + title/body, whole-category
// or targeted audience, send-now or schedule. The reach line previews the
// recipient count through the SAME opt-out predicate the sender uses, so
// what it says is what will happen. Opt-out always wins, even when targeting.

const STATUS_STYLE: Record<BroadcastRow['status'], { label: string; bg: string }> = {
  pending: { label: 'SCHEDULED', bg: 'rgba(232,255,71,0.14)' },
  sending: { label: 'SENDING', bg: 'rgba(232,255,71,0.14)' },
  sent: { label: 'SENT', bg: 'rgba(74,222,128,0.14)' },
  failed: { label: 'FAILED', bg: 'rgba(255,79,109,0.14)' },
  canceled: { label: 'CANCELED', bg: 'rgba(255,255,255,0.08)' },
}

export default function BroadcastAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()
  const { loading, rawCategories, rawPlayers, rawBroadcasts, reload } = useBroadcastAdminData()

  // Composer state.
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'category' | 'targeted'>('category')
  const [targets, setTargets] = useState<{ id: string; name: string }[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reach preview, debounced against category/audience changes.
  const [reach, setReach] = useState<{ targeted: number; reachable: number } | null>(null)
  const targetIds = useMemo(() => targets.map(t => t.id), [targets])
  useEffect(() => {
    if (!categoryId || !isAdmin) { setReach(null); return }
    const ids = audience === 'targeted' ? targetIds : null
    if (audience === 'targeted' && targetIds.length === 0) { setReach(null); return }
    let stale = false
    const timer = setTimeout(async () => {
      const { data, error } = await broadcasts.reach(categoryId, ids)
      if (!stale && !error && data && data.length > 0) {
        setReach({ targeted: data[0].targeted, reachable: data[0].reachable })
      }
    }, 350)
    return () => { stale = true; clearTimeout(timer) }
  }, [categoryId, audience, targetIds, isAdmin])

  const categoryOptions = useMemo(
    () => rawCategories.map(c => ({ key: c.id, label: c.label })),
    [rawCategories],
  )

  const composeValid =
    !!categoryId && title.trim().length > 0 && body.trim().length > 0 &&
    (audience === 'category' || targets.length > 0)

  function resetComposer() {
    setTitle('')
    setBody('')
    setTargets([])
    setAudience('category')
  }

  async function createBroadcast(scheduledFor: Date | null): Promise<string | null> {
    if (!categoryId || !playerId) return null
    const { data, error } = await broadcasts.create({
      category_id: categoryId,
      title: title.trim(),
      body: body.trim(),
      target_player_ids: audience === 'targeted' ? targets.map(t => t.id) : null,
      created_by: playerId,
      ...(scheduledFor ? { scheduled_for: scheduledFor.toISOString() } : {}),
    })
    if (error) {
      showToast(error.message, 'error')
      return null
    }
    return data?.id ?? null
  }

  async function onSendNow() {
    setSaving(true)
    try {
      const id = await createBroadcast(null)
      if (!id) return
      const result = await broadcasts.sendNow(id)
      if (result.ok) {
        showToast(`Sent to ${result.delivered ?? 0} device${result.delivered === 1 ? '' : 's'}`, 'success')
      } else {
        // The row exists; the cron sweep will retry a claimable failure.
        showToast(result.message ?? result.failedWith ?? 'Send failed', 'error')
      }
      resetComposer()
      reload()
    } finally {
      setSaving(false)
    }
  }

  async function onSchedule(when: Date) {
    setSaving(true)
    try {
      const id = await createBroadcast(when)
      if (!id) return
      showToast('Broadcast scheduled', 'success')
      setScheduleOpen(false)
      resetComposer()
      reload()
    } finally {
      setSaving(false)
    }
  }

  const [cancelTarget, setCancelTarget] = useState<BroadcastRow | null>(null)
  async function onCancel(b: BroadcastRow) {
    const { error } = await broadcasts.cancel(b.id)
    if (error) showToast(error.message, 'error')
    else showToast('Broadcast canceled', 'success')
    setCancelTarget(null)
    reload()
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <ScreenContainer title="Broadcasts" scroll={false}>
        <EmptyCard text="Admins only" style={{ marginHorizontal: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer
      title="Broadcasts"
      subtitle="Push notifications to the league"
      onRefresh={reload}
      overlay={<Toast />}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Composer ── */}
      <Text style={styles.sectionHeader}>NEW BROADCAST</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>CATEGORY</Text>
        <ToggleGroup options={categoryOptions} value={categoryId} onChange={setCategoryId} />

        <Text style={styles.fieldLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Bowling starts at 7 tonight"
          placeholderTextColor={colors.muted2}
          maxLength={120}
        />

        <Text style={styles.fieldLabel}>MESSAGE</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={body}
          onChangeText={setBody}
          placeholder="The notification body"
          placeholderTextColor={colors.muted2}
          multiline
          maxLength={1000}
        />

        <Text style={styles.fieldLabel}>AUDIENCE</Text>
        <ToggleGroup
          options={[
            { key: 'category', label: 'Everyone (opted in)' },
            { key: 'targeted', label: 'Specific players' },
          ]}
          value={audience}
          onChange={setAudience}
        />

        {audience === 'targeted' && (
          <View style={styles.targets}>
            {targets.map(t => (
              <TouchableOpacity
                key={t.id}
                style={styles.chip}
                onPress={() => setTargets(prev => prev.filter(p => p.id !== t.id))}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{t.name} ✕</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.chipAdd} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
              <Text style={styles.chipAddText}>+ Add player</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reach: preview through the same predicate the sender uses. */}
        {reach && (
          <Text style={[styles.reach, reach.reachable === 0 && styles.reachZero]}>
            {reach.targeted} targeted · {reach.reachable} reachable
            {reach.reachable === 0 ? ' — no one will receive this (opted out or no devices)' : ''}
          </Text>
        )}

        <View style={styles.ctaRow}>
          <Button
            variant="outline"
            label="Schedule…"
            onPress={() => setScheduleOpen(true)}
            disabled={!composeValid || saving}
            fullWidth
            style={styles.ctaBtn}
          />
          <Button
            label="Send Now"
            onPress={onSendNow}
            loading={saving}
            disabled={!composeValid || saving}
            fullWidth
            style={styles.ctaBtn}
          />
        </View>
      </View>

      {/* ── History ── */}
      <Text style={styles.sectionHeader}>HISTORY</Text>
      {rawBroadcasts.length === 0 ? (
        <EmptyCard text="Nothing sent yet" />
      ) : (
        rawBroadcasts.map(b => {
          const badge = STATUS_STYLE[b.status]
          const when = b.status === 'pending'
            ? `Scheduled ${new Date(b.scheduled_for).toLocaleString()}`
            : b.status === 'sent'
              ? `${b.delivered_count ?? 0} delivered · ${new Date(b.sent_at ?? b.created_at).toLocaleString()}`
              : b.status === 'failed'
                ? (b.error ?? 'Failed')
                : new Date(b.created_at).toLocaleString()
          return (
            <View key={b.id} style={styles.card}>
              <View style={styles.histHead}>
                <Text style={styles.histTitle} numberOfLines={1}>{b.title}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.badgeText}>{badge.label}</Text>
                </View>
              </View>
              <Text style={styles.histBody} numberOfLines={2}>{b.body}</Text>
              <Text style={styles.histMeta}>
                {b.broadcast_categories?.label ?? '—'}
                {b.target_player_ids ? ` · ${b.target_player_ids.length} targeted` : ' · everyone'}
                {b.players?.name ? ` · by ${b.players.name}` : ''}
              </Text>
              <Text style={[styles.histMeta, b.status === 'failed' && styles.histError]}>{when}</Text>
              {b.status === 'pending' && (
                <TouchableOpacity onPress={() => setCancelTarget(b)} activeOpacity={0.7}>
                  <Text style={styles.cancelLink}>Cancel →</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        })
      )}

      <PlayerPickerModal
        visible={pickerOpen}
        title="Add recipient"
        items={rawPlayers.filter(p => !targets.some(t => t.id === p.id))}
        onSelectItem={item => { setTargets(prev => [...prev, item]); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)}
      />

      {scheduleOpen && (
        <ScheduleModal
          busy={saving}
          onConfirm={onSchedule}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {cancelTarget && (
        <ConfirmCancelModal
          broadcast={cancelTarget}
          onConfirm={() => onCancel(cancelTarget)}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </ScreenContainer>
  )
}

// ── Schedule modal — pick a future date+time for the cron sweep to fire at ──
function ScheduleModal({
  busy,
  onConfirm,
  onClose,
}: {
  busy: boolean
  onConfirm: (when: Date) => void
  onClose: () => void
}) {
  const picker = useDatePicker(() => new Date(Date.now() + 60 * 60_000))
  const inPast = picker.value.getTime() <= Date.now()

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Schedule broadcast</Text>
          <Text style={styles.modalHint}>
            Sends automatically within a minute of the chosen time (device-local).
          </Text>

          {Platform.OS === 'android' && (
            <Button
              variant="outline"
              selectable
              value={picker.value.toLocaleString()}
              onPress={() => picker.setOpen(true)}
              style={{ marginTop: 12 }}
            />
          )}
          {(Platform.OS === 'ios' || picker.open) && (
            <DateTimePicker
              value={picker.value}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={picker.onChange}
              minimumDate={new Date()}
              themeVariant="dark"
            />
          )}

          {inPast && <Text style={styles.modalWarn}>Pick a time in the future.</Text>}

          <View style={styles.modalBtns}>
            <Button variant="outline" label="Back" onPress={onClose} fullWidth style={styles.modalCancel} />
            <Button
              label="Schedule"
              onPress={() => onConfirm(picker.value)}
              disabled={busy || inPast}
              loading={busy}
              fullWidth
            />
          </View>
        </View>
        <Toast />
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Cancel confirm ──
function ConfirmCancelModal({
  broadcast,
  onConfirm,
  onClose,
}: {
  broadcast: BroadcastRow
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Cancel this broadcast?</Text>
          <Text style={styles.modalHint}>
            "{broadcast.title}" — scheduled for {new Date(broadcast.scheduled_for).toLocaleString()}.
            It will never send.
          </Text>
          <View style={styles.modalBtns}>
            <Button variant="outline" label="Keep it" onPress={onClose} fullWidth style={styles.modalCancel} />
            <Button variant="danger" label="Cancel broadcast" onPress={onConfirm} fullWidth />
          </View>
        </View>
        <Toast />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  fieldLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
  },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text },
  chipAdd: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipAddText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.accent },
  reach: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.success,
    marginTop: 12,
  },
  reachZero: { color: colors.danger },
  ctaRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  ctaBtn: { flex: 1 },

  histHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histTitle: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, letterSpacing: 0.3 },
  badge: { borderRadius: radius.icon, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.text },
  histBody: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 4 },
  histMeta: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 0.3, color: colors.muted, marginTop: 6 },
  histError: { color: colors.danger },
  cancelLink: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.danger, letterSpacing: 0.5, marginTop: 10 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border2,
    padding: 20,
  },
  modalTitle: { fontFamily: fonts.barlowCondensed, fontSize: 20, color: colors.text, letterSpacing: 0.5 },
  modalHint: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 8 },
  modalWarn: { fontFamily: fonts.barlow, fontSize: 12, color: colors.danger, marginTop: 8 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalCancel: { borderWidth: 0, paddingVertical: 12 },
})
