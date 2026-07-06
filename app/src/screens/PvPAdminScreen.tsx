import { useCallback, useEffect, useMemo, useState } from 'react'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import PvpChallengeRow from '../components/pvp/PvpChallengeRow'
import PvpAdminActionModal from '../components/pvp/PvpAdminActionModal'
import { useAuthStore } from '../stores/authStore'
import { seasons, pvpChallenges } from '../utils/supabase/db'
import { normalizeChallenge, PvpChallengeView } from '../hooks/usePvpData'
import { CONTRACT_TYPE_LABEL, STATUS_LABEL } from '../utils/pvp'
import EmptyCard from '../components/ui/EmptyCard'

const STATUS_FILTERS = ['All', 'pending', 'countered', 'locked', 'settled']

export default function PvPAdminScreen() {
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

  const rows = useMemo(
    () => (filter === 'All' ? contracts : contracts.filter(c => c.status === filter)),
    [contracts, filter],
  )

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <ScreenContainer title="PvP Admin" scroll={false}>
        <EmptyCard text="Admins only" style={{ margin: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer
      title="PvP Admin"
      subtitle="Settle, cancel, or void contracts"
      pinned={
        <PillFilter
          items={STATUS_FILTERS}
          value={filter}
          onChange={setFilter}
          renderLabel={item => (item === 'All' ? 'All' : STATUS_LABEL[item] ?? item)}
        />
      }
      onRefresh={load}
    >
      {rows.length === 0 ? (
        <EmptyCard text="No open, active, or settled contracts." style={{ margin: 16 }} />
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

      {target && (
        <PvpAdminActionModal challenge={target} onClose={() => setTarget(null)} onDone={load} />
      )}
    </ScreenContainer>
  )
}
