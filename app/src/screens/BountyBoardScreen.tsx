import { useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import BountyCard from '../components/BountyCard'
import { useBountyBoardData, BountyView } from '../hooks/useBountyBoardData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function BountyBoardScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  const { loading, balance, openBoard, mySponsored, myHunted, settled, reload } = useBountyBoardData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  // Refresh on return (e.g. after posting or entering). Silent after first load.
  useFocusEffect(useCallback(() => { reload() }, [reload]))

  if (loading) return <LoadingView label="Loading…" />

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
      <ScreenHeader title="Bounties" subtitle="Post a bounty, or join the hunt" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <View style={styles.balancePill}>
          <Text style={styles.balancePillLabel}>BALANCE</Text>
          <Text style={styles.balancePillValue}>{balance.toLocaleString()} pins</Text>
        </View>

        <TouchableOpacity
          style={styles.postBtn}
          onPress={() => navigation.navigate('BountyCreate')}
          activeOpacity={0.7}
        >
          <Text style={styles.postBtnText}>+ Post a Bounty</Text>
        </TouchableOpacity>

        {nothing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No bounties yet. Post one to get the hunt started.</Text>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balancePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  balancePillLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted },
  balancePillValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },

  postBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 20,
  },
  postBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },

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
