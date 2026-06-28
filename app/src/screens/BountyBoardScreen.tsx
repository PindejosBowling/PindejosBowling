import { useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import ArtworkToggle from '../components/ui/ArtworkToggle'
import BountyBoardBackdrop from '../components/pixelart/BountyBoardBackdrop'
import LoadingView from '../components/ui/LoadingView'
import BountyCard from '../components/bounty/BountyCard'
import BalancePill from '../components/ui/BalancePill'
import { useBountyBoardData, BountyView } from '../hooks/useBountyBoardData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function BountyBoardScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const artworkReveal = useUiStore(s => s.artworkReveal)

  const { loading, balance, openBoard, mySponsored, myHunted, settled, reload } = useBountyBoardData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  // Refresh on return (e.g. after posting or entering). Silent after first load.
  useFocusEffect(useCallback(() => { reload() }, [reload]))

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BountyBoardBackdrop />
      <ScreenHeader title="Bounties" subtitle="Join the hunt & prosper together" onBack={() => navigation.goBack()} right={<ArtworkToggle />} />
      {!artworkReveal && (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <BalancePill balance={balance} />

        {/* v1 is House-only: the player "Post a Bounty" entry point is intentionally
            hidden (the create_sponsor_bounty RPC is also revoked at the DB layer).
            The BountyCreate route/screen are kept for a future player-sponsor phase
            — re-add this CTA + re-GRANT the RPC to restore it. */}

        {nothing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No bounties right now. Check back when the Pinsino posts one to hunt.</Text>
          </View>
        ) : (
          <>
            {section('OPEN BOUNTIES', openBoard)}
            {section('MY SPONSORED', mySponsored)}
            {section('MY HUNTED', myHunted)}
            {section('SETTLED', settled)}
          </>
        )}
      </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },


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
