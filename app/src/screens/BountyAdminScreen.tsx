import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import BountyCard from '../components/bounty/BountyCard'
import BountyAdminActionModal from '../components/bounty/BountyAdminActionModal'
import BountyHouseCreateModal from '../components/bounty/BountyHouseCreateModal'
import Button from '../components/ui/Button'
import { useAuthStore } from '../stores/authStore'
import { seasons, weeks, bountyPosts } from '../utils/supabase/db'
import { normalizeBounty, BountyView } from '../hooks/useBountyBoardData'
import EmptyCard from '../components/ui/EmptyCard'

const STATUS_FILTERS = ['All', 'open', 'closed', 'settled']

export default function BountyAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const [loading, setLoading] = useState(true)
  const [bounties, setBounties] = useState<BountyView[]>([])
  const [weekId, setWeekId] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [target, setTarget] = useState<BountyView | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // Between seasons we fall back to the most-recently-ended season so leftover
  // bounties can still be closed/settled. Creation is disabled in that state
  // (no current week, and a new bounty must not land in a dead season).
  const [seasonConcluded, setSeasonConcluded] = useState(false)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonRes, weekRes] = await Promise.all([seasons.getCurrentOrLastEnded(), weeks.getCurrent()])
      const seasonId = seasonRes.data?.id ?? null
      setSeasonConcluded(seasonRes.concluded)
      setSeasonNumber(seasonRes.data?.number ?? null)
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

  const rows = useMemo(
    () => (filter === 'All' ? bounties : bounties.filter(b => b.status === filter)),
    [bounties, filter],
  )

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <ScreenContainer title="Bounty Admin" scroll={false}>
        <EmptyCard text="Admins only" style={{ margin: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer
      title="Bounty Admin"
      subtitle={seasonConcluded ? `Season ${seasonNumber} · final cleanup` : 'Create House bounties, close, settle, cancel'}
      pinned={
        <PillFilter items={STATUS_FILTERS} value={filter} onChange={setFilter} renderLabel={item => item === 'All' ? 'All' : item.toUpperCase()} />
      }
      onRefresh={load}
    >
      {seasonConcluded ? (
        <Text style={styles.concludedNote}>
          Season ended — close out remaining bounties. Creation resumes next season.
        </Text>
      ) : (
        <Button label="+ Create House Bounty" onPress={() => setCreateOpen(true)} style={styles.createBtn} />
      )}

      {rows.length === 0 ? (
        <EmptyCard text="No bounties for this filter." style={{ margin: 16 }} />
      ) : (
        rows.map(b => (
          <BountyCard key={b.id} bounty={b} onPress={() => setTarget(b)} manageHint />
        ))
      )}

      {target && (
        <BountyAdminActionModal bounty={target} onClose={() => setTarget(null)} onDone={load} />
      )}
      {createOpen && !seasonConcluded && (
        <BountyHouseCreateModal weekId={weekId} onClose={() => setCreateOpen(false)} onDone={load} />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  createBtn: { marginTop: 4, marginBottom: 16 },
  concludedNote: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 16,
  },
})
