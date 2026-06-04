import { useMemo, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useRegistrationData } from '../hooks/useRegistrationData'
import { useRefresh } from '../hooks/useRefresh'
import { registrations, seasons } from '../utils/supabase/db'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'
import PillFilter from '../components/PillFilter'
import AdminOpenRegistrationModal from '../components/AdminOpenRegistrationModal'

type Nav = NativeStackNavigationProp<MoreStackParamList>

type SeasonStatus = 'open' | 'ongoing' | 'completed'

const STATUS_LABEL: Record<SeasonStatus, string> = {
  open: 'OPEN',
  ongoing: 'ONGOING',
  completed: 'COMPLETED',
}

function formatDate(date: string | null): string {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function RegistrationScreen() {
  const navigation = useNavigation<Nav>()
  const { loading, rawRegistrations, seasonList, allPlayers, reload } = useRegistrationData()
  const { refreshing, onRefresh } = useRefresh(reload)
  const { showToast } = useUiStore()
  const playerId = useAuthStore(s => s.playerId)
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const [selectedNumber, setSelectedNumber] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showOpenModal, setShowOpenModal] = useState(false)

  const openSeason = useMemo(
    () => seasonList.find(s => s.registration_open) ?? null,
    [seasonList],
  )

  const seasonNumbers = useMemo(() => seasonList.map(s => String(s.number)), [seasonList])

  // Default to the open season if there is one, else the latest season.
  const activeNumber = useMemo(() => {
    if (selectedNumber != null) return selectedNumber
    if (openSeason) return String(openSeason.number)
    return seasonList.length ? String(seasonList[seasonList.length - 1].number) : ''
  }, [selectedNumber, openSeason, seasonList])

  const activeSeason = useMemo(
    () => seasonList.find(s => String(s.number) === activeNumber) ?? null,
    [activeNumber, seasonList],
  )

  const registrantIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rawRegistrations) {
      if (activeSeason && r.season_id === activeSeason.id) ids.add(r.player_id)
    }
    return ids
  }, [rawRegistrations, activeSeason])

  // Registered players for the active season, sorted by name (read-only display).
  const registrants = useMemo(() => {
    if (!activeSeason) return []
    return rawRegistrations
      .filter(r => r.season_id === activeSeason.id)
      .map(r => ({ id: r.player_id, name: r.players?.name ?? 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rawRegistrations, activeSeason])

  const isOpen = !!activeSeason?.registration_open
  const status: 'open' | 'ongoing' | 'completed' = isOpen
    ? 'open'
    : activeSeason?.is_active
      ? 'ongoing'
      : 'completed'
  const isSelfRegistered = playerId != null && registrantIds.has(playerId)

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

  const toggleSelf = useCallback(() => {
    if (playerId) setRegistered(playerId, !isSelfRegistered)
  }, [playerId, isSelfRegistered, activeSeason, saving])

  async function closeRegistration() {
    if (!activeSeason || saving) return
    setSaving(true)
    try {
      const { error } = await seasons.update(activeSeason.id, { registration_open: false, is_active: true })
      if (error) { showToast(error.message, 'error'); return }
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
    Alert.alert(
      `Delete Season ${activeSeason.number}?`,
      'This permanently removes the season and its registrations. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteSeason },
      ],
    )
  }

  if (loading && rawRegistrations.length === 0) return <LoadingView label="Loading registration" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Registration" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
        }
      >
        {isAdmin && !openSeason && (
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
              <View
                style={[
                  styles.statusBadge,
                  status === 'open' ? styles.statusOpen : status === 'ongoing' ? styles.statusOngoing : styles.statusClosed,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    status === 'open' ? styles.statusTextOpen : status === 'ongoing' ? styles.statusTextOngoing : styles.statusTextClosed,
                  ]}
                >
                  {STATUS_LABEL[status]}
                </Text>
              </View>
            </View>
            <Text style={styles.dateLine}>
              {formatDate(activeSeason.start_date)}
              {activeSeason.end_date ? ` – ${formatDate(activeSeason.end_date)}` : ''}
            </Text>
            <Text style={styles.countLine}>
              {registrants.length} {registrants.length === 1 ? 'player' : 'players'} registered
            </Text>

            {/* Self register/withdraw — any signed-in player, open season only */}
            {isOpen && playerId && (
              <TouchableOpacity
                style={[styles.selfBtn, isSelfRegistered ? styles.selfBtnOut : styles.selfBtnIn, saving && styles.btnDisabled]}
                onPress={toggleSelf}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={isSelfRegistered ? colors.danger : colors.bg} />
                ) : (
                  <Text style={[styles.selfBtnText, isSelfRegistered ? styles.selfBtnTextOut : styles.selfBtnTextIn]}>
                    {isSelfRegistered ? 'Withdraw me' : "I'm in — Register me"}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Admin: manage the full roster for an open season */}
            {isOpen && isAdmin ? (
              <>
                <Text style={styles.sectionLabel}>MANAGE ROSTER</Text>
                <View style={styles.rosterBox}>
                  {allPlayers.map(p => {
                    const registered = registrantIds.has(p.id)
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.playerRow}
                        onPress={() => setRegistered(p.id, !registered)}
                        disabled={saving}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, registered && styles.checkboxOn]}>
                          {registered && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={[styles.playerName, registered && styles.playerNameOn]}>{p.name}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
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
            ) : (
              // Read-only registrant list (closed season, or non-admin view)
              <>
                <Text style={styles.sectionLabel}>REGISTERED</Text>
                {registrants.length === 0 ? (
                  <Text style={styles.empty}>No one registered yet.</Text>
                ) : (
                  <View style={styles.rosterBox}>
                    {registrants.map(p => (
                      <View key={p.id} style={styles.playerRow}>
                        <View style={[styles.checkbox, styles.checkboxOn]}>
                          <Text style={styles.checkmark}>✓</Text>
                        </View>
                        <Text style={[styles.playerName, styles.playerNameOn]}>{p.name}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {isAdmin && (
        <AdminOpenRegistrationModal
          visible={showOpenModal}
          onClose={() => setShowOpenModal(false)}
          onCreated={reload}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 32 },

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
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  statusOngoing: { backgroundColor: 'transparent', borderColor: colors.success },
  statusClosed: { backgroundColor: 'transparent', borderColor: colors.border2 },
  statusText: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1 },
  statusTextOpen: { color: colors.accent },
  statusTextOngoing: { color: colors.success },
  statusTextClosed: { color: colors.muted },

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

  selfBtn: {
    borderRadius: radius.cardSm,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 16,
  },
  selfBtnIn: { backgroundColor: colors.accent },
  selfBtnOut: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  selfBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  selfBtnTextIn: { color: colors.bg },
  selfBtnTextOut: { color: colors.danger },

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
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 10,
  },
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
  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },
})
