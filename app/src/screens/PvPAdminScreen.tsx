import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import PvpChallengeRow from '../components/PvpChallengeRow'
import PvpAdminActionModal from '../components/PvpAdminActionModal'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { seasons, pvpChallenges } from '../utils/supabase/db'
import { normalizeChallenge, PvpChallengeView } from '../hooks/usePvpData'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL } from '../utils/pvp'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const STATUS_FILTERS = ['All', 'pending', 'countered', 'locked']

export default function PvPAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<PvpChallengeView[]>([])
  const [filter, setFilter] = useState('All')
  const [target, setTarget] = useState<PvpChallengeView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) { setContracts([]); return }
      const { data } = await pvpChallenges.listLockedBySeason(seasonId)
      setContracts((data ?? []).map(normalizeChallenge))
    } catch (e) {
      console.error('PvPAdmin load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const { refreshing, onRefresh } = useRefresh(load)

  const rows = useMemo(
    () => (filter === 'All' ? contracts : contracts.filter(c => c.status === filter)),
    [contracts, filter],
  )

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="PvP Admin" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.emptyText}>Admins only</Text></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="PvP Admin" subtitle="Settle, cancel, or void contracts" onBack={() => navigation.goBack()} />

      <PillFilter
        items={STATUS_FILTERS}
        value={filter}
        onChange={setFilter}
        renderLabel={item => (item === 'All' ? 'All' : STATUS_LABEL[item] ?? item)}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {rows.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>No open or active contracts.</Text></View>
        ) : (
          rows.map(c => (
            <PvpChallengeRow
              key={c.id}
              challenge={c}
              viewerId={null}
              onPress={() => setTarget(c)}
              cta={`${CONTRACT_TYPE_LABEL[c.contractType] ?? c.contractType} · tap to manage`}
            />
          ))
        )}
      </ScrollView>

      {target && (
        <PvpAdminActionModal challenge={target} onClose={() => setTarget(null)} onDone={load} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    margin: 16,
  },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3 },
})
