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
import BountyCard from '../components/BountyCard'
import BountyAdminActionModal from '../components/BountyAdminActionModal'
import BountyHouseCreateModal from '../components/BountyHouseCreateModal'
import Button from '../components/Button'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { seasons, weeks, bountyPosts } from '../utils/supabase/db'
import { normalizeBounty, BountyView } from '../hooks/useBountyBoardData'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const STATUS_FILTERS = ['All', 'open', 'closed', 'settled']

export default function BountyAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const [loading, setLoading] = useState(true)
  const [bounties, setBounties] = useState<BountyView[]>([])
  const [weekId, setWeekId] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [target, setTarget] = useState<BountyView | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonRes, weekRes] = await Promise.all([seasons.getCurrent(), weeks.getCurrent()])
      const seasonId = seasonRes.data?.id ?? null
      setWeekId(weekRes.data?.id ?? null)
      if (!seasonId) { setBounties([]); return }
      const { data } = await bountyPosts.listBySeason(seasonId)
      setBounties((data ?? []).map(normalizeBounty))
    } catch (e) {
      console.error('BountyAdmin load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const { refreshing, onRefresh } = useRefresh(load)

  const rows = useMemo(
    () => (filter === 'All' ? bounties : bounties.filter(b => b.status === filter)),
    [bounties, filter],
  )

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Bounty Admin" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.emptyText}>Admins only</Text></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bounty Admin" subtitle="Create House bounties, close, settle, cancel" onBack={() => navigation.goBack()} />

      <PillFilter items={STATUS_FILTERS} value={filter} onChange={setFilter} renderLabel={item => item === 'All' ? 'All' : item.toUpperCase()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <Button label="+ Create House Bounty" onPress={() => setCreateOpen(true)} style={styles.createBtn} />

        {rows.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>No bounties for this filter.</Text></View>
        ) : (
          rows.map(b => (
            <BountyCard key={b.id} bounty={b} onPress={() => setTarget(b)} manageHint />
          ))
        )}
      </ScrollView>

      {target && (
        <BountyAdminActionModal bounty={target} onClose={() => setTarget(null)} onDone={load} />
      )}
      {createOpen && (
        <BountyHouseCreateModal weekId={weekId} onClose={() => setCreateOpen(false)} onDone={load} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  createBtn: { marginTop: 4, marginBottom: 16 },
  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.cardMd, borderWidth: 1, borderColor: colors.border,
    padding: 20, alignItems: 'center', margin: 16,
  },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3 },
})
