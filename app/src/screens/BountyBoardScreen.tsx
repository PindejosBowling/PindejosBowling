import { useCallback } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import BountyBoardBackdrop from '../components/pixelart/BountyBoardBackdrop'
import BountyCard from '../components/bounty/BountyCard'
import BalancePill from '../components/ui/BalancePill'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import { useBountyBoardData, BountyView } from '../hooks/useBountyBoardData'
import { useEconomyRefresh } from '../hooks/useEconomyRefresh'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function BountyBoardScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, balance, openBoard, mySponsored, myHunted, settled, reload } = useBountyBoardData(playerId, pinsinoViewSeasonId)

  // Refresh on return (e.g. after posting or entering). Silent after first load.
  // Badges reload alongside the data so the bounty count never goes stale.
  const reloadAll = useEconomyRefresh(reload)
  useFocusEffect(useCallback(() => { reloadAll() }, [reloadAll]))

  const section = (title: string, rows: BountyView[]) =>
    rows.length > 0 ? (
      <>
        <Text style={styles.sectionLabel}>{title} ({rows.length})</Text>
        {rows.map(b => (
          <BountyCard
            key={b.id}
            bounty={b}
            viewerId={playerId}
            onPress={() => navigation.navigate('BountyDetail', { bountyId: b.id })}
          />
        ))}
      </>
    ) : null

  const nothing =
    openBoard.length === 0 && mySponsored.length === 0 && myHunted.length === 0 && settled.length === 0

  return (
    <ScreenContainer
      title="Bounties"
      subtitle="Join the hunt & prosper together"
      backdrop={<BountyBoardBackdrop />}
      onRefresh={reloadAll}
    >
        {readOnly && <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />}

        <BalancePill balance={balance} />

        {/* v1 is House-only: the player "Post a Bounty" entry point is intentionally
            hidden (the create_sponsor_bounty RPC is also revoked at the DB layer).
            The BountyCreate route/screen are kept for a future player-sponsor phase
            — re-add this CTA + re-GRANT the RPC to restore it. */}

        {nothing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {readOnly ? 'No bounties this season.' : 'No bounties right now. Check back when the Pinsino posts one to hunt.'}
            </Text>
          </View>
        ) : (
          <>
            {section('OPEN BOUNTIES', openBoard)}
            {section('MY SPONSORED', mySponsored)}
            {section('MY HUNTED', myHunted)}
            {section('SETTLED', settled)}
          </>
        )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
})
