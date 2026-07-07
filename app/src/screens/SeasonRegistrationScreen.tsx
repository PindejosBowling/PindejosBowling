import { useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useRegistrationData, SeasonOption } from '../hooks/useRegistrationData'
import { registrations, seasons, weeks } from '../utils/supabase/db'
import LoadingView from '../components/ui/LoadingView'
import ScreenContainer from '../components/ui/ScreenContainer'
import PillFilter from '../components/ui/PillFilter'
import AdminOpenRegistrationModal from '../components/admin/AdminOpenRegistrationModal'
import AdminEditSeasonModal from '../components/admin/AdminEditSeasonModal'

function formatDate(date: string | null): string {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function SeasonRegistrationScreen() {
  const { loading, rawRegistrations, seasonList, allPlayers, reload } = useRegistrationData()
  const { showToast } = useUiStore()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const [selectedNumber, setSelectedNumber] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [editSeason, setEditSeason] = useState<SeasonOption | null>(null)

  const openSeason = useMemo(
    () => seasonList.find(s => s.registration_open) ?? null,
    [seasonList],
  )

  const seasonNumbers = useMemo(() => seasonList.map(s => String(s.number)), [seasonList])

  const activeNumber = useMemo(() => {
    if (selectedNumber != null) return selectedNumber
    if (openSeason) return String(openSeason.number)
    return seasonList.length ? String(seasonList[seasonList.length - 1].number) : ''
  }, [selectedNumber, openSeason, seasonList])

  const activeSeason = useMemo(
    () => seasonList.find(s => String(s.number) === activeNumber) ?? null,
    [activeNumber, seasonList],
  )

  // Registration rows for the active season, keyed by player for quick lookup.
  const regByPlayer = useMemo(() => {
    const map = new Map<string, { paid: boolean }>()
    if (activeSeason) {
      for (const r of rawRegistrations) {
        if (r.season_id === activeSeason.id) map.set(r.player_id, { paid: r.payment_received })
      }
    }
    return map
  }, [rawRegistrations, activeSeason])

  const registrantCount = regByPlayer.size

  const isOpen = !!activeSeason?.registration_open

  async function setRegistered(pid: string, registered: boolean) {
    if (!activeSeason || saving) return
    setSaving(true)
    try {
      const { error } = registered
        ? await registrations.insert({ season_id: activeSeason.id, player_id: pid })
        : await registrations.remove(activeSeason.id, pid)
      if (error) { showToast(error.message, 'error'); return }
      await reload()
    } catch {
      showToast('Could not update registration', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function togglePayment(pid: string, paid: boolean) {
    if (!activeSeason || saving) return
    setSaving(true)
    try {
      const { error } = await registrations.setPayment(activeSeason.id, pid, !paid)
      if (error) { showToast(error.message, 'error'); return }
      await reload()
    } catch {
      showToast('Could not update payment', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function closeRegistration() {
    if (!activeSeason || saving) return
    setSaving(true)
    try {
      const { error } = await seasons.update(activeSeason.id, { registration_open: false, is_active: true })
      if (error) { showToast(error.message, 'error'); return }
      // Activating the season is not enough: RSVPs and team generation read
      // weeks.getCurrent(), so the season needs Week 1 to exist before anyone
      // can RSVP. Seed it now (idempotent — only if the season has no weeks).
      const existing = await weeks.listBySeason(activeSeason.id)
      if (existing.error) { showToast(existing.error.message, 'error'); return }
      if ((existing.data ?? []).length === 0) {
        const { error: weekErr } = await weeks.insert({ season_id: activeSeason.id, week_number: 1 })
        if (weekErr) { showToast(weekErr.message, 'error'); return }
      }
      showToast(`Registration closed for Season ${activeSeason.number}`, 'success')
      await reload()
    } catch {
      showToast('Could not close registration', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSeason() {
    if (!activeSeason || saving) return
    setSaving(true)
    try {
      const { error } = await seasons.remove(activeSeason.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast(`Deleted Season ${activeSeason.number}`, 'success')
      setSelectedNumber(null)
      await reload()
    } catch {
      showToast('Could not delete season', 'error')
    } finally {
      setSaving(false)
    }
  }

  function confirmDeleteSeason() {
    if (!activeSeason || saving) return
    // Only an open (registration) season is safe to delete — guarded again in the DB.
    if (!activeSeason.registration_open) {
      showToast('Only a season with open registration can be deleted', 'error')
      return
    }
    Alert.alert(
      `Delete Season ${activeSeason.number}?`,
      'This permanently removes the season and its registrations. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteSeason },
      ],
    )
  }

  if (!isAdmin) {
    return (
      <ScreenContainer title="Season Registration">
        <View style={styles.emptyCard}>
          <Text style={styles.empty}>Admins only</Text>
        </View>
      </ScreenContainer>
    )
  }

  if (loading && rawRegistrations.length === 0) return <LoadingView label="Loading registration" />

  return (
    <ScreenContainer title="Season Registration" onRefresh={reload} contentStyle={styles.content}>
        {!openSeason && (
          <TouchableOpacity
            style={styles.openBtn}
            onPress={() => setShowOpenModal(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.openBtnText}>＋ Open Registration for a New Season</Text>
          </TouchableOpacity>
        )}

        <PillFilter
          items={seasonNumbers}
          value={activeNumber}
          onChange={setSelectedNumber}
          renderLabel={(s) => {
            const season = seasonList.find(x => String(x.number) === s)
            return season?.registration_open ? `Season ${s} · Open` : `Season ${s}`
          }}
        />

        {!activeSeason ? (
          <Text style={styles.empty}>No seasons yet.</Text>
        ) : (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Season {activeSeason.number}</Text>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => setEditSeason(activeSeason)}
                activeOpacity={0.7}
              >
                <Text style={styles.editBtnText}>Edit details</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.dateLine}>
              {formatDate(activeSeason.start_date)}
              {activeSeason.end_date ? ` – ${formatDate(activeSeason.end_date)}` : ''}
            </Text>
            <Text style={styles.countLine}>
              {registrantCount} {registrantCount === 1 ? 'player' : 'players'} registered
            </Text>

            {/* Roster: assign players (open season) + toggle payment for those registered. */}
            <Text style={styles.sectionLabel}>ROSTER</Text>
            <View style={styles.rosterBox}>
              {allPlayers.map(p => {
                const reg = regByPlayer.get(p.id)
                const registered = !!reg
                return (
                  <View key={p.id} style={styles.playerRow}>
                    <TouchableOpacity
                      style={styles.checkArea}
                      onPress={() => isOpen && setRegistered(p.id, !registered)}
                      disabled={saving || !isOpen}
                      activeOpacity={isOpen ? 0.7 : 1}
                    >
                      <View style={[styles.checkbox, registered && styles.checkboxOn]}>
                        {registered && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <Text style={[styles.playerName, registered && styles.playerNameOn]}>{p.name}</Text>
                    </TouchableOpacity>
                    {registered && (
                      <TouchableOpacity
                        style={[styles.payPill, reg!.paid ? styles.payPaid : styles.payUnpaid]}
                        onPress={() => togglePayment(p.id, reg!.paid)}
                        disabled={saving}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.payText, reg!.paid ? styles.payTextPaid : styles.payTextUnpaid]}>
                          {reg!.paid ? 'Paid' : 'Mark paid'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              })}
            </View>

            {/* Close + Delete are only valid for an OPEN season. Once registration
                closes, the season accrues real game data and must not be deleted. */}
            {isOpen && (
              <>
                <TouchableOpacity
                  style={[styles.closeBtn, saving && styles.btnDisabled]}
                  onPress={closeRegistration}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  <Text style={styles.closeBtnText}>Close Registration & Lock Roster</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deleteBtn, saving && styles.btnDisabled]}
                  onPress={confirmDeleteSeason}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteBtnText}>Delete Season</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

      {/* Native modals render in an overlay layer, so mounting them inside the
          container's ScrollView is visually identical to the old sibling mount. */}
      {showOpenModal && (
        <AdminOpenRegistrationModal
          onClose={() => setShowOpenModal(false)}
          onCreated={reload}
        />
      )}
      {editSeason && (
        <AdminEditSeasonModal
          season={editSeason}
          onClose={() => setEditSeason(null)}
          onSaved={reload}
        />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  // Overrides the container default: this screen's cards manage their own
  // horizontal margins.
  content: { paddingHorizontal: 0, paddingBottom: 32 },

  openBtn: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 13,
    alignItems: 'center',
  },
  openBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  panel: {
    marginHorizontal: 16,
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  editBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  dateLine: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
    marginTop: 6,
  },
  countLine: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 14,
  },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  rosterBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardSm,
    marginBottom: 16,
    overflow: 'hidden',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  checkArea: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { fontSize: 13, color: colors.bg, fontWeight: '700', lineHeight: 15 },
  playerName: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.muted, letterSpacing: 0.3 },
  playerNameOn: { color: colors.text, fontWeight: '700' },

  payPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  payPaid: { backgroundColor: 'rgba(74,222,128,0.12)', borderColor: colors.success },
  payUnpaid: { backgroundColor: 'transparent', borderColor: colors.muted2 },
  payText: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 0.5 },
  payTextPaid: { color: colors.success },
  payTextUnpaid: { color: colors.muted2 },

  closeBtn: {
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  closeBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.danger,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  deleteBtn: {
    marginTop: 10,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  deleteBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  btnDisabled: { opacity: 0.5 },
  emptyCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },
})
