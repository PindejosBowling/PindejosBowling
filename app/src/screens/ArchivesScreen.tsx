import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Modal,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import Toast from '../components/ui/Toast'
import { useRefresh } from '../hooks/useRefresh'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { seasons, archives } from '../utils/supabase/db'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type ArchivedWeek = { id: string; week_number: number; bowled_at: string | null }

const CONFIRM_BODY =
  'Reverses every Pinsino effect this week derived (pins, bet/PvP settlements, loan ' +
  'garnishment, feed events), deletes the next week, and reopens this week — scores ' +
  'become editable and the week is in play again. Fix whatever needs fixing (or ' +
  'nothing), then re-run Archive & Advance from Matchups to settle it again.'

export default function ArchivesScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [weeks, setWeeks] = useState<ArchivedWeek[]>([])

  // Confirmation flow state. `forceArmed` is set after the server rejects an
  // unforced unarchive because week N+1 holds downstream activity.
  const [pending, setPending] = useState<{ week: ArchivedWeek } | null>(null)
  const [busy, setBusy] = useState(false)
  const [forceArmed, setForceArmed] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: season } = await seasons.getCurrent()
    if (!season) {
      setWeeks([])
      setLoading(false)
      return
    }
    const { data } = await archives.listArchivedWeeks(season.id)
    setWeeks((data ?? []) as ArchivedWeek[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const { refreshing, onRefresh } = useRefresh(load)

  function openConfirm(week: ArchivedWeek) {
    setPending({ week })
    setForceArmed(false)
    setWarning(null)
  }

  function closeConfirm() {
    if (busy) return
    setPending(null)
    setForceArmed(false)
    setWarning(null)
  }

  async function runUnarchive() {
    if (!pending) return
    setBusy(true)
    const { week } = pending
    const { error } = await archives.unarchiveWeek(week.id, forceArmed)
    setBusy(false)

    if (error) {
      // The RPC raises (before mutating) when week N+1 holds activity — surface it
      // and arm a forced retry rather than failing outright.
      if (!forceArmed && /downstream activity/i.test(error.message)) {
        setWarning(error.message)
        setForceArmed(true)
        return
      }
      showToast(`Unarchive failed: ${error.message}`, 'error')
      return
    }

    showToast(`Week ${week.week_number} unarchived — back in play`, 'success')
    setPending(null)
    setForceArmed(false)
    setWarning(null)
    load()
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Archives" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Admins only</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="Archives" onBack={() => navigation.goBack()} />

        <Text style={styles.intro}>
          Unarchiving a week reverses its Pinsino settlement (pins, bet/PvP
          settlements, loan garnishment, feed events), deletes the next week, and
          puts the week back in play with its teams and scores intact. Re-archive
          it from Matchups with Archive & Advance. Only the most recently archived
          week can be unarchived.
        </Text>

        <Text style={styles.sectionHeader}>ARCHIVED WEEKS</Text>

        {weeks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No archived weeks this season</Text>
          </View>
        ) : (
          weeks.map((w, i) => (
            <View key={w.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.weekTitle}>Week {w.week_number}</Text>
                {i === 0 && <Text style={styles.latestBadge}>MOST RECENT</Text>}
              </View>
              {w.bowled_at && <Text style={styles.bowledAt}>Bowled {w.bowled_at}</Text>}
              {/* LIFO: only the most-recent archived week is reversible. */}
              <View style={styles.btnRow}>
                <Button
                  label="Unarchive"
                  variant="outline"
                  tone="danger"
                  onPress={() => openConfirm(w)}
                  disabled={i !== 0}
                  fullWidth
                />
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={closeConfirm}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeConfirm}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
            {pending && (
              <>
                <Text style={styles.sheetTitle}>
                  Unarchive Week {pending.week.week_number}?
                </Text>
                <Text style={styles.sheetBody}>{CONFIRM_BODY}</Text>
                {warning && (
                  <View style={styles.warnBox}>
                    <Text style={styles.warnText}>{warning}</Text>
                    <Text style={styles.warnSub}>
                      Forcing will delete the next week and its activity (bets are refunded).
                    </Text>
                  </View>
                )}
                <View style={styles.btnRow}>
                  <Button label="Cancel" variant="secondary" onPress={closeConfirm} fullWidth />
                  <Button
                    label={forceArmed ? 'Force Unarchive' : 'Unarchive'}
                    variant={forceArmed ? 'danger' : 'primary'}
                    onPress={runUnarchive}
                    loading={busy}
                    disabled={busy}
                    fullWidth
                  />
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
        {/* Mounted inside the Modal so toasts aren't occluded by the native layer. */}
        <Toast />
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  intro: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 20,
  },
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 10,
  },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 24,
  },
  summaryHeader: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 14,
  },
  summaryRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 2,
  },
  summaryName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.gold,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  summaryScores: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  summaryUse: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 3,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    fontWeight: '700',
  },
  latestBadge: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.gold,
    letterSpacing: 1,
  },
  bowledAt: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 14,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },

  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  sheetBody: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 18,
  },
  warnBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
    marginBottom: 18,
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
})
