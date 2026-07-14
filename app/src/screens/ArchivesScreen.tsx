import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import Button from '../components/ui/Button'
import CenterModal from '../components/ui/CenterModal'
import { useRefresh } from '../hooks/useRefresh'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { seasons, archives } from '../utils/supabase/db'
import EmptyCard from '../components/ui/EmptyCard'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type ArchivedWeek = { id: string; week_number: number; bowled_at: string | null; settled_at: string | null }
// The two reversals mirror the two forward steps (Advance → Settle):
//   Unsettle  = inverse of Settle  (money reversed, week stays advanced/locked)
//   Unadvance = inverse of Advance (delete N+1, reopen the week for score edits)
// A settled week is fully reopened by Unsettle then Unadvance — two taps that
// mirror the two forward taps. Unadvance uses unarchive_week (with a settled week
// it would reverse both, but we only ever offer it once already unsettled).
type Mode = 'unadvance' | 'unsettle'

const UNSETTLE_BODY =
  "Reverses only this week's money settlement (pins, bet/PvP settlements, loan " +
  'garnishment, the House P/L feed card) but keeps the week advanced and its scores ' +
  'locked. Use it to re-derive money — then run Settle Week again from the LaneTalk ' +
  'import screen to settle it fresh (e.g. after a correction or a late import).'

const UNADVANCE_BODY =
  'Undoes the advance: deletes the next week and reopens this one — scores become ' +
  'editable and it is back in play. Re-run Advance Week from Matchups when ready. ' +
  '(To reverse a settled week, Unsettle it first.)'

export default function ArchivesScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [weeks, setWeeks] = useState<ArchivedWeek[]>([])

  // Confirmation flow state. `mode` picks the RPC: unsettle (money only) or
  // unadvance (delete N+1 + reopen). `forceArmed` is set after the server rejects
  // an unforced unadvance because week N+1 holds downstream activity (unsettle has
  // no force flow).
  const [pending, setPending] = useState<{ week: ArchivedWeek; mode: Mode } | null>(null)
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

  function openConfirm(week: ArchivedWeek, mode: Mode) {
    setPending({ week, mode })
    setForceArmed(false)
    setWarning(null)
  }

  function closeConfirm() {
    if (busy) return
    setPending(null)
    setForceArmed(false)
    setWarning(null)
  }

  async function runAction() {
    if (!pending) return
    setBusy(true)
    const { week, mode } = pending
    const { error } = mode === 'unsettle'
      ? await archives.unsettleWeek(week.id)
      : await archives.unarchiveWeek(week.id, forceArmed)
    setBusy(false)

    const verb = mode === 'unsettle' ? 'Unsettle' : 'Unadvance'

    if (error) {
      // Unadvance raises (before mutating) when week N+1 holds activity — surface
      // it and arm a forced retry. Unsettle has no downstream/force flow.
      if (mode === 'unadvance' && !forceArmed && /downstream activity/i.test(error.message)) {
        setWarning(error.message)
        setForceArmed(true)
        return
      }
      showToast(`${verb} failed: ${error.message}`, 'error')
      return
    }

    showToast(
      mode === 'unsettle'
        ? `Week ${week.week_number} unsettled — re-settle from the LaneTalk screen`
        : `Week ${week.week_number} unadvanced — back in play`,
      'success',
    )
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
        <EmptyCard text="Admins only" />
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
          Undo the weekly clock in the reverse of how it ran.{'\n\n'}
          <Text style={styles.introStrong}>Unsettle</Text> (a settled week) reverses
          its money — pins, bet/PvP settlements, loan garnishment, House P/L — but
          keeps it advanced and locked. Re-run Settle Week from the LaneTalk screen
          to re-derive.{'\n\n'}
          <Text style={styles.introStrong}>Unadvance</Text> (an advanced, unsettled
          week) deletes the next week and reopens this one for score edits. Only the
          most recent week can be unadvanced. To fully reopen a settled week,
          Unsettle it first, then Unadvance.
        </Text>

        <Text style={styles.sectionHeader}>ARCHIVED WEEKS</Text>

        {weeks.length === 0 ? (
          <EmptyCard text="No archived weeks this season" />
        ) : (
          weeks.map((w, i) => (
            <View key={w.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.weekTitle}>Week {w.week_number}</Text>
                {i === 0 && <Text style={styles.latestBadge}>MOST RECENT</Text>}
              </View>
              {w.bowled_at && <Text style={styles.bowledAt}>Bowled {w.bowled_at}</Text>}
              {/* Mirror of the forward flow: a SETTLED week shows Unsettle (money
                  only, any week — no LIFO); an ADVANCED-but-unsettled week shows
                  Unadvance (deletes N+1, LIFO — most-recent only). Never both. */}
              <View style={styles.btnRow}>
                {w.settled_at != null ? (
                  <Button
                    label="Unsettle"
                    variant="outline"
                    tone="danger"
                    onPress={() => openConfirm(w, 'unsettle')}
                    fullWidth
                  />
                ) : (
                  <Button
                    label="Unadvance"
                    variant="outline"
                    tone="danger"
                    onPress={() => openConfirm(w, 'unadvance')}
                    disabled={i !== 0}
                    fullWidth
                  />
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {pending && (() => {
        const verb = pending.mode === 'unsettle' ? 'Unsettle' : 'Unadvance'
        const body = pending.mode === 'unsettle' ? UNSETTLE_BODY : UNADVANCE_BODY
        return (
        <CenterModal
          title={`${verb} Week ${pending.week.week_number}?`}
          onClose={closeConfirm}
          busy={busy}
          showClose={false}
          footer={
            <View style={styles.btnRow}>
              <Button label="Cancel" variant="secondary" onPress={closeConfirm} fullWidth />
              <Button
                label={forceArmed ? `Force ${verb}` : verb}
                variant={forceArmed ? 'danger' : 'primary'}
                onPress={runAction}
                loading={busy}
                disabled={busy}
                fullWidth
              />
            </View>
          }
        >
          <Text style={styles.sheetBody}>{body}</Text>
          {warning && (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>{warning}</Text>
              <Text style={styles.warnSub}>
                Forcing will delete the next week and its activity (bets are refunded).
              </Text>
            </View>
          )}
        </CenterModal>
        )
      })()}
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
  introStrong: {
    fontFamily: fonts.barlowCondensed,
    color: colors.text,
    fontWeight: '700',
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
