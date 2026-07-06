import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import Toast from '../components/ui/Toast'
import PillFilter from '../components/ui/PillFilter'
import Button from '../components/ui/Button'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { seasons, activityFeed } from '../utils/supabase/db'
import { normalizeFeedRow } from '../hooks/useMarketMovesData'
import { renderFeedEvent, FeedEventView } from '../utils/activityFeedTemplates'
import EmptyCard from '../components/ui/EmptyCard'

// Client-side admin filters (design §18). Reuse the string-keyed pill component.
const FEATURE_FILTERS = ['all', 'sportsbook', 'loan_shark', 'pvp', 'system', 'admin']
const STATUS_FILTERS = ['all', 'published', 'suppressed']
const IMPORTANCE_FILTERS = ['all', 'highlight', 'major']
const FILTER_LABELS: Record<string, string> = {
  all: 'All',
  sportsbook: 'Sportsbook',
  loan_shark: 'Loan Shark',
  pvp: 'PvP',
  system: 'System',
  admin: 'Admin',
  published: 'Published',
  suppressed: 'Suppressed',
  highlight: 'Highlight',
  major: 'Major',
}

export default function MarketMovesAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [events, setEvents] = useState<FeedEventView[]>([])

  const [featureFilter, setFeatureFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [importanceFilter, setImportanceFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [actionEvent, setActionEvent] = useState<FeedEventView | null>(null)
  const [postOpen, setPostOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const sid = seasonRes.data?.id ?? null
      setSeasonId(sid)
      if (!sid) { setEvents([]); return }
      const { data } = await activityFeed.listAllForAdmin(sid)
      setEvents((data ?? []).map(normalizeFeedRow))
    } catch (e) {
      console.error('MarketMovesAdmin load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(
    () =>
      events.filter(
        e =>
          (featureFilter === 'all' || e.sourceFeature === featureFilter) &&
          (statusFilter === 'all' || e.status === statusFilter) &&
          (importanceFilter === 'all' || e.importance === importanceFilter),
      ),
    [events, featureFilter, statusFilter, importanceFilter],
  )

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <ScreenContainer title="Market Moves Admin" scroll={false}>
        <EmptyCard text="Admins only" style={{ marginHorizontal: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer
      title="Market Moves Admin"
      subtitle="Moderate the feed"
      pinned={
        <>
          <PillFilter items={FEATURE_FILTERS} value={featureFilter} onChange={setFeatureFilter} renderLabel={i => FILTER_LABELS[i] ?? i} />
          <PillFilter items={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} renderLabel={i => FILTER_LABELS[i] ?? i} />
          <PillFilter items={IMPORTANCE_FILTERS} value={importanceFilter} onChange={setImportanceFilter} renderLabel={i => FILTER_LABELS[i] ?? i} />
        </>
      }
      onRefresh={load}
      contentStyle={styles.content}
      overlay={<Toast />}
    >
        <Button variant="outline" label="+ Post system event" onPress={() => setPostOpen(true)} style={styles.postBtn} />

        {filtered.length === 0 ? (
          <EmptyCard text="No events match these filters" style={{ marginHorizontal: 16 }} />
        ) : (
          filtered.map(e => {
            const parts = renderFeedEvent(e)
            const isExpanded = expanded.has(e.id)
            const sourceLink = e.sportsbookBetId
              ? `bet ${e.sportsbookBetId.slice(0, 8)}`
              : e.loanId
                ? `loan ${e.loanId.slice(0, 8)}`
                : e.pvpChallengeId
                  ? `pvp ${e.pvpChallengeId.slice(0, 8)}`
                  : null
            return (
              <View key={e.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardLine}>{parts.icon} {parts.line}</Text>
                  <View style={[styles.statusBadge, e.status === 'suppressed' ? styles.statusSuppressed : styles.statusPublished]}>
                    <Text style={styles.statusText}>{e.status.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.cardMeta}>
                  {e.sourceFeature} · {e.eventType} · {e.importance}
                  {sourceLink ? ` · ${sourceLink}` : ''}
                </Text>
                {e.status === 'suppressed' && e.suppressionReason ? (
                  <Text style={styles.reasonText}>Reason: {e.suppressionReason}</Text>
                ) : null}

                <View style={styles.cardActions}>
                  <TouchableOpacity onPress={() => toggleExpanded(e.id)} activeOpacity={0.7}>
                    <Text style={styles.linkText}>{isExpanded ? '▾ Payloads' : '▸ Payloads'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setActionEvent(e)} activeOpacity={0.7}>
                    <Text style={styles.linkText}>
                      {e.status === 'published' ? 'Suppress' : 'Restore'} →
                    </Text>
                  </TouchableOpacity>
                </View>

                {isExpanded && (
                  <View style={styles.inspector}>
                    <Text style={styles.inspectorLabel}>public_payload</Text>
                    <Text style={styles.inspectorJson}>{JSON.stringify(e.publicPayload, null, 2)}</Text>
                    <Text style={[styles.inspectorLabel, { marginTop: 8 }]}>admin_payload</Text>
                    <Text style={styles.inspectorJson}>{JSON.stringify(e.adminPayload, null, 2)}</Text>
                  </View>
                )}
              </View>
            )
          })
        )}

      {actionEvent && (
        <ModerationModal
          event={actionEvent}
          onClose={() => setActionEvent(null)}
          onDone={() => { setActionEvent(null); load() }}
        />
      )}
      {postOpen && (
        <PostSystemEventModal
          onClose={() => setPostOpen(false)}
          onDone={() => { setPostOpen(false); load() }}
        />
      )}
    </ScreenContainer>
  )
}

// ── Suppress / Restore modal ─────────────────────────────────────────────────
function ModerationModal({
  event,
  onClose,
  onDone,
}: {
  event: FeedEventView
  onClose: () => void
  onDone: () => void
}) {
  const { showToast } = useUiStore()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const parts = renderFeedEvent(event)
  const suppressing = event.status === 'published'

  async function submit() {
    setBusy(true)
    try {
      if (suppressing) {
        if (!reason.trim()) { showToast('Enter a reason', 'error'); return }
        const { error } = await activityFeed.suppress(event.id, reason.trim())
        if (error) { showToast(error.message, 'error'); return }
        showToast('Event suppressed', 'success')
      } else {
        const { error } = await activityFeed.restore(event.id)
        if (error) { showToast(error.message, 'error'); return }
        showToast('Event restored', 'success')
      }
      onDone()
    } catch {
      showToast('Action failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{suppressing ? 'Suppress event' : 'Restore event'}</Text>
          <Text style={styles.modalLine}>{parts.icon} {parts.line}</Text>

          {suppressing ? (
            <>
              <Text style={styles.modalHint}>Hides this card from the public feed. The source action is untouched.</Text>
              <TextInput
                style={styles.modalInput}
                value={reason}
                onChangeText={setReason}
                placeholder="Reason"
                placeholderTextColor={colors.muted2}
                multiline
              />
            </>
          ) : (
            <Text style={styles.modalHint}>Returns this card to the public feed.</Text>
          )}

          <View style={styles.modalBtns}>
            <Button variant="outline" label="Cancel" onPress={onClose} fullWidth style={styles.modalCancel} />
            <Button label={suppressing ? 'Suppress' : 'Restore'} onPress={submit} disabled={busy} fullWidth />
          </View>
        </View>
        <Toast />
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Post system event modal (design §19.1) ───────────────────────────────────
// v1 catalog supports one sourceless, public, no-actor event the admin can post:
// loan_shark_special_offer (§11.3). Importance is derived from the event type by
// the Market Moves feature (importanceForEvent) — not selectable here.
function PostSystemEventModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { showToast } = useUiStore()
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const { error } = await activityFeed.createSystemEvent({
        sourceFeature: 'system',
        eventType: 'loan_shark_special_offer',
        templateKey: 'loan_shark.special_offer',
        publicPayload: {},
      })
      if (error) { showToast(error.message, 'error'); return }
      showToast('Event posted', 'success')
      onDone()
    } catch {
      showToast('Failed to post', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Post system event</Text>
          <Text style={styles.modalLine}>🦈 The Loan Shark is offering dangerous terms this week.</Text>
          <Text style={styles.modalHint}>Posts a public Loan Shark special-offer card to the feed.</Text>

          <View style={styles.modalBtns}>
            <Button variant="outline" label="Cancel" onPress={onClose} fullWidth style={styles.modalCancel} />
            <Button label="Post" onPress={submit} disabled={busy} fullWidth />
          </View>
        </View>
        <Toast />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  // Merged over ScreenContainer's default { paddingHorizontal: 16, paddingBottom: 40 }.
  content: { paddingTop: 4 },

  postBtn: { paddingVertical: 12, marginBottom: 16 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardLine: { flex: 1, fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 19 },
  statusBadge: { borderRadius: radius.icon, paddingHorizontal: 8, paddingVertical: 3 },
  statusPublished: { backgroundColor: colors.accentDim },
  statusSuppressed: { backgroundColor: 'rgba(255,79,109,0.14)' },
  statusText: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.text },
  cardMeta: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 0.3, color: colors.muted, marginTop: 6 },
  reasonText: { fontFamily: fonts.barlow, fontSize: 12, color: colors.danger, marginTop: 4 },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  linkText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.accent, letterSpacing: 0.5 },
  inspector: {
    marginTop: 12,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    padding: 10,
  },
  inspectorLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1, color: colors.muted },
  inspectorJson: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: colors.text, marginTop: 2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border2,
    padding: 20,
  },
  modalTitle: { fontFamily: fonts.barlowCondensed, fontSize: 20, color: colors.text, letterSpacing: 0.5 },
  modalLine: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 19, marginTop: 10 },
  modalHint: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 8 },
  modalInput: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    marginTop: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  fieldLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted, marginTop: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalCancel: { borderWidth: 0, paddingVertical: 12 },
})
