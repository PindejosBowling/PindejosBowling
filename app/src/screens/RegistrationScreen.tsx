import { useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useRegistrationData } from '../hooks/useRegistrationData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import ScreenContainer from '../components/ui/ScreenContainer'
import PillFilter from '../components/ui/PillFilter'

type Nav = NativeStackNavigationProp<MoreStackParamList>

type SeasonStatus = 'open' | 'ongoing' | 'completed'

const STATUS_LABEL: Record<SeasonStatus, string> = {
  open: 'OPEN FOR REGISTRATION',
  ongoing: 'IN PROGRESS',
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
  const { loading, rawRegistrations, seasonList, reload } = useRegistrationData()

  const [selectedNumber, setSelectedNumber] = useState<string | null>(null)

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

  // Registered players for the active season, sorted by name (read-only display).
  const registrants = useMemo(() => {
    if (!activeSeason) return []
    return rawRegistrations
      .filter(r => r.season_id === activeSeason.id)
      .map(r => ({
        id: r.player_id,
        name: r.players?.name ?? 'Unknown',
        paid: r.payment_received,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rawRegistrations, activeSeason])

  const status: SeasonStatus = activeSeason?.registration_open
    ? 'open'
    : activeSeason?.is_active
      ? 'ongoing'
      : 'completed'

  if (loading && rawRegistrations.length === 0) return <LoadingView label="Loading registration" />

  return (
    <ScreenContainer
      title="Registration"
      onBack={() => navigation.navigate('MoreHome')}
      onRefresh={reload}
      contentStyle={styles.content}
    >
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

            <Text style={styles.sectionLabel}>REGISTERED</Text>
            {registrants.length === 0 ? (
              <Text style={styles.empty}>No one registered yet.</Text>
            ) : (
              <View style={styles.rosterBox}>
                {registrants.map(p => (
                  <View key={p.id} style={styles.playerRow}>
                    <Text style={styles.playerName}>{p.name}</Text>
                    <View
                      style={[styles.statusPill, p.paid ? styles.pillComplete : styles.pillPending]}
                    >
                      <Text style={[styles.pillText, p.paid ? styles.pillTextComplete : styles.pillTextPending]}>
                        {p.paid ? 'Complete' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  // Overrides the container default: this screen's cards manage their own
  // horizontal margins.
  content: { paddingHorizontal: 0, paddingBottom: 32 },

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
    paddingVertical: 10,
    gap: 10,
  },
  playerName: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, letterSpacing: 0.3, fontWeight: '700' },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillComplete: { backgroundColor: 'rgba(74,222,128,0.12)', borderColor: colors.success },
  pillPending: { backgroundColor: 'transparent', borderColor: colors.muted2 },
  pillText: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 0.5 },
  pillTextComplete: { color: colors.success },
  pillTextPending: { color: colors.muted2 },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },
})
