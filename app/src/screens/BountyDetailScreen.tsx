import { useCallback, useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import BountyEntryModal from '../components/BountyEntryModal'
import Button from '../components/Button'
import { useBountyDetail } from '../hooks/useBountyDetail'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { bountyEconomics, hunterPayout, formatCloseTime } from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>
type Rt = RouteProp<PinsinoStackParamList, 'BountyDetail'>

const LEDGER_LABEL: Record<string, string> = {
  bounty_sponsor_stake: 'Sponsor stake',
  bounty_hunter_stake: 'Hunter stake',
  bounty_payout: 'Payout',
}

export default function BountyDetailScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Rt>()
  const playerId = useAuthStore(s => s.playerId)
  const { bountyId } = route.params

  const { loading, bounty, hunters, settlement, payouts, ledger, reload } = useBountyDetail(bountyId)
  const { refreshing, onRefresh } = useRefresh(reload)
  const [entryOpen, setEntryOpen] = useState(false)

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  // Live economics over the current hunters (pre-settlement estimate, design §34.4).
  const econ = useMemo(
    () => (bounty ? bountyEconomics(bounty.rewardPerHunter, hunters) : null),
    [bounty, hunters],
  )

  // The viewer can join when the bounty is open, has a free slot, they aren't the
  // sponsor, and they haven't already entered (design §29.2).
  const canJoin = useMemo(() => {
    if (!bounty || bounty.status !== 'open' || !playerId) return false
    if (bounty.slotsRemaining <= 0) return false
    if (bounty.sponsorPlayerId === playerId) return false
    return !hunters.some(h => h.playerId === playerId)
  }, [bounty, hunters, playerId])

  if (loading) return <LoadingView label="Loading…" />

  if (!bounty) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Bounty" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.emptyText}>This bounty is no longer available.</Text></View>
      </SafeAreaView>
    )
  }

  const sponsorLabel = bounty.bountyType === 'house_bounty' ? 'The Pinsino' : (bounty.sponsorName ?? '—')

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bounty" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <Text style={styles.title}>{bounty.title}</Text>
        <Text style={styles.sponsor}>
          by {sponsorLabel} · {bounty.status.toUpperCase()} · Closes {formatCloseTime(bounty.closesAt)}
        </Text>
        <Text style={styles.description}>{bounty.description}</Text>

        <View style={styles.amountRow}>
          <View style={styles.amountCell}>
            <Text style={styles.amountValue}>{bounty.hunterStakeAmount.toLocaleString()}</Text>
            <Text style={styles.amountLabel}>HUNTER STAKE</Text>
          </View>
          <View style={styles.amountCell}>
            <Text style={styles.amountValue}>+{bounty.rewardPerHunter.toLocaleString()}</Text>
            <Text style={styles.amountLabel}>REWARD EACH</Text>
          </View>
          <View style={styles.amountCell}>
            <Text style={styles.amountValue}>{bounty.hunterCount}/{bounty.maxHunters}</Text>
            <Text style={styles.amountLabel}>HUNTERS</Text>
          </View>
        </View>

        {/* Hunters */}
        <Text style={styles.sectionLabel}>HUNTERS ({hunters.length}/{bounty.maxHunters})</Text>
        {hunters.length === 0 ? (
          <View style={styles.card}><Text style={styles.muted}>No hunters yet.</Text></View>
        ) : (
          <View style={styles.card}>
            {hunters.map((h, i) => (
              <View key={h.id} style={[styles.listRow, i < hunters.length - 1 && styles.listRowBorder]}>
                <Text style={styles.listPrimary}>#{h.entryNumber} · {h.playerName ?? 'Hunter'}</Text>
                <Text style={styles.listValue}>+{bounty.rewardPerHunter.toLocaleString()} reward</Text>
              </View>
            ))}
          </View>
        )}

        {/* Pot economics */}
        {econ && (
          <View style={styles.card}>
            <View style={styles.kv}><Text style={styles.muted}>Reward per hunter</Text><Text style={styles.kvValue}>+{bounty.rewardPerHunter.toLocaleString()}</Text></View>
            <View style={styles.kv}><Text style={styles.muted}>Total reward if hunters win</Text><Text style={styles.kvValue}>{econ.totalReward.toLocaleString()}</Text></View>
            <View style={styles.kv}><Text style={styles.muted}>Total paid to hunters</Text><Text style={styles.kvAccent}>{(settlement?.totalPot ?? econ.totalHunterPayout).toLocaleString()}</Text></View>
          </View>
        )}

        {/* Payout previews (pre-settlement) */}
        {!settlement && econ && (
          <>
            <Text style={styles.sectionLabel}>IF IT SETTLES NOW</Text>
            <View style={styles.card}>
              <View style={styles.kv}><Text style={styles.muted}>Sponsor wins → sponsor keeps</Text><Text style={styles.kvValue}>{econ.sponsorTakeOnWin.toLocaleString()}</Text></View>
              {hunters.map(h => (
                <View key={h.id} style={styles.kv}>
                  <Text style={styles.muted}>Hunters win → {h.playerName ?? `Hunter #${h.entryNumber}`}</Text>
                  <Text style={styles.kvValue}>{hunterPayout(h.stakeAmount, bounty.rewardPerHunter).toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Settlement result */}
        {settlement && (
          <>
            <Text style={styles.sectionLabel}>RESULT — {settlement.outcome === 'sponsor_win' ? 'SPONSOR WON' : 'HUNTERS WON'}</Text>
            <View style={styles.card}>
              <Text style={styles.reasoningLabel}>ADMIN REASONING</Text>
              <Text style={styles.reasoning}>{settlement.reasoning}</Text>
              <View style={[styles.kv, { marginTop: 10 }]}><Text style={styles.muted}>Total hunter stakes</Text><Text style={styles.kvValue}>{settlement.totalHunterStakes.toLocaleString()}</Text></View>
              <View style={styles.kv}><Text style={styles.muted}>Total reward paid</Text><Text style={styles.kvValue}>{settlement.totalReward.toLocaleString()}</Text></View>
              {settlement.houseSeed > 0 && (
                <View style={styles.kv}><Text style={styles.muted}>House subsidy</Text><Text style={styles.kvValue}>{settlement.houseSeed.toLocaleString()}</Text></View>
              )}
              <View style={styles.kv}><Text style={styles.muted}>{settlement.outcome === 'sponsor_win' ? 'Sponsor winnings' : 'Total paid to hunters'}</Text><Text style={styles.kvAccent}>{settlement.totalPot.toLocaleString()}</Text></View>
            </View>
            {payouts.filter(p => !p.isHouse).length > 0 && (
              <View style={styles.card}>
                {payouts.filter(p => !p.isHouse).map((p, i, arr) => (
                  <View key={p.id} style={[styles.kv, i < arr.length - 1 && styles.listRowBorder]}>
                    <Text style={styles.muted}>{p.playerName ?? 'Player'}</Text>
                    <Text style={styles.kvAccent}>+{p.amount.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Ledger events */}
        {ledger.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>LEDGER</Text>
            <View style={styles.card}>
              {ledger.map((r, i) => (
                <View key={r.id} style={[styles.kv, i < ledger.length - 1 && styles.listRowBorder]}>
                  <Text style={styles.muted}>
                    {LEDGER_LABEL[r.type] ?? r.type} · {r.isHouse ? 'House' : (r.playerName ?? 'Player')}
                  </Text>
                  <Text style={[styles.kvValue, { color: r.amount >= 0 ? colors.success : colors.danger }]}>
                    {r.amount >= 0 ? '+' : ''}{r.amount.toLocaleString()}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {canJoin && (
          <Button label="Join the Hunt" size="lg" onPress={() => setEntryOpen(true)} style={styles.joinBtn} />
        )}
      </ScrollView>

      {entryOpen && (
        <BountyEntryModal bounty={bounty} onClose={() => setEntryOpen(false)} onDone={reload} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  title: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 26, color: colors.text, marginTop: 8 },
  sponsor: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 4 },
  description: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text, lineHeight: 22, marginTop: 12 },

  amountRow: { flexDirection: 'row', marginTop: 16, marginBottom: 4 },
  amountCell: { flex: 1, alignItems: 'center' },
  amountValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 26, color: colors.accent },
  amountLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1, color: colors.muted, marginTop: 2 },

  sectionLabel: { fontFamily: fonts.barlowCondensed, fontSize: 13, letterSpacing: 2, color: colors.muted, marginTop: 20, marginBottom: 10 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  listPrimary: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  listValue: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.success },

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  kvAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 17, color: colors.accent },
  muted: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, flex: 1, marginRight: 8 },

  reasoningLabel: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted, marginBottom: 4 },
  reasoning: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 20 },

  joinBtn: { marginTop: 24 },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.cardMd, borderWidth: 1, borderColor: colors.border,
    padding: 20, alignItems: 'center', margin: 16,
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center' },
})
