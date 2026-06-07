import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import PvpAcceptModal from '../components/PvpAcceptModal'
import PvpCounterModal from '../components/PvpCounterModal'
import LineDuelLines from '../components/LineDuelLines'
import { usePvpChallengeDetail, PvpOfferView, PvpLedgerView } from '../hooks/usePvpChallengeDetail'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { seasons, pinLedger, pvpChallenges } from '../utils/supabase/db'
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPE_RULE, STATUS_LABEL, statusKind, formatStakes, isAsymmetricStakes } from '../utils/pvp'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>
type Rt = RouteProp<PinsinoStackParamList, 'PvPChallengeDetail'>

const LEDGER_LABEL: Record<string, string> = {
  stake: 'STAKE ESCROWED',
  payout: 'WINNINGS',
  refund: 'REFUND',
}

export default function PvPChallengeDetailScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Rt>()
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const { loading, challenge: c, offers, ledger, reload } = usePvpChallengeDetail(route.params.challengeId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [balance, setBalance] = useState(0)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [declining, setDeclining] = useState(false)

  useEffect(() => {
    (async () => {
      if (!playerId) return
      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) return
      const { data } = await pinLedger.listByPlayerSeason(playerId, seasonId)
      setBalance(((data ?? []) as any[]).reduce((s, e) => s + e.amount, 0))
    })()
  }, [playerId])

  // The actionable state for the viewer.
  const actions = useMemo(() => {
    if (!c) return { canAccept: false, canDecline: false, canCounter: false, canRematch: false }
    const isCreator = playerId === c.creatorId
    const isParty = isCreator || playerId === c.counterpartyId
    const isOpenBoard = c.counterpartyId == null
    const myTurn = c.activeOfferBy != null && c.activeOfferBy !== playerId
    const live = c.status === 'pending' || c.status === 'countered'

    // Live + (a party whose turn it is) OR (an open-board contract viewed by a non-creator).
    const canRespond = live && ((isParty && myTurn) || (isOpenBoard && !isCreator))
    // Decline only for an actual party (not a stranger grief-cancelling an open board).
    const canDecline = canRespond && isParty
    // Rematch: the loser of a settled contract.
    const canRematch = c.status === 'settled' && isParty && c.winnerId != null && c.winnerId !== playerId
    return { canAccept: canRespond, canDecline, canCounter: canRespond, canRematch }
  }, [c, playerId])

  async function decline() {
    if (!c) return
    setDeclining(true)
    try {
      const { error } = await pvpChallenges.decline(c.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Challenge declined', 'success')
      await reload()
    } catch {
      showToast('Failed to decline', 'error')
    } finally {
      setDeclining(false)
    }
  }

  function confirmDecline() {
    Alert.alert('Decline challenge?', 'This cancels the contract. No pins have been staked yet.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: decline },
    ])
  }

  if (loading) return <LoadingView label="Loading…" />
  if (!c) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Challenge" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}><Text style={styles.emptyText}>Challenge not found</Text></View>
      </SafeAreaView>
    )
  }

  const kind = statusKind(c.status)
  const statusColor = kind === 'live' ? colors.gold : kind === 'active' ? colors.accent : colors.muted
  const rd = c.resultDetail ?? {}
  const showResult = c.status === 'settled' || c.status === 'pushed'
  const isProp = c.contractType === 'prop_duel'
  const isCustom = c.contractType === 'custom'
  const asymmetric = isAsymmetricStakes(c.creatorStake, c.counterpartyStake)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={(isCustom && c.customTitle) || CONTRACT_TYPE_LABEL[c.contractType] || 'Challenge'}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Status + participants */}
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.matchup}>{c.creatorName} vs {c.counterpartyName ?? 'Open'}</Text>
            <Text style={[styles.statusBadge, { color: statusColor }]}>{(STATUS_LABEL[c.status] ?? c.status).toUpperCase()}</Text>
          </View>

          <View style={styles.termGrid}>
            <View style={styles.termCell}>
              <Text style={styles.termLabel}>{asymmetric ? 'STAKES' : 'STAKE EACH'}</Text>
              <Text style={asymmetric ? styles.termValueSm : styles.termValue}>
                {asymmetric ? formatStakes(c.creatorStake, c.counterpartyStake) : c.creatorStake.toLocaleString()}
              </Text>
            </View>
            <View style={styles.termCell}>
              <Text style={styles.termLabel}>POT</Text>
              <Text style={styles.termValueAccent}>{c.totalPot.toLocaleString()}</Text>
            </View>
            <View style={styles.termCell}>
              <Text style={styles.termLabel}>WINNER GETS</Text>
              <Text style={styles.termValueAccent}>{c.payoutAmount.toLocaleString()}</Text>
            </View>
          </View>

          {asymmetric ? (
            <Text style={styles.sides}>
              Stakes — {c.creatorName}: {c.creatorStake.toLocaleString()} · {c.counterpartyName ?? 'Taker'}: {c.counterpartyStake.toLocaleString()}
            </Text>
          ) : null}

          {!isCustom ? (
            <View style={styles.metaLine}>
              <Text style={styles.metaText}>{c.gameNumber != null ? `Game ${c.gameNumber}` : 'Series'}</Text>
            </View>
          ) : null}

          {isCustom && c.customDescription ? (
            <Text style={styles.sides}>{c.customDescription}</Text>
          ) : null}

          {isProp && (c.creatorSelection || c.counterpartySelection) ? (
            <Text style={styles.sides}>
              {c.creatorName}: {c.creatorSelection?.toUpperCase()} · {c.counterpartyName ?? 'Taker'}: {c.counterpartySelection?.toUpperCase()}
            </Text>
          ) : null}

          {c.contractType === 'line_duel' ? (
            <LineDuelLines
              sides={[
                { name: c.creatorName, value: c.creatorLine != null ? c.creatorLine.toFixed(1) : '—' },
                {
                  name: c.counterpartyName ?? 'Taker',
                  value: c.counterpartyLine != null
                    ? c.counterpartyLine.toFixed(1)
                    : c.counterpartyId == null ? 'Set when taken' : '—',
                },
              ]}
            />
          ) : null}

          <Text style={styles.rule}>{CONTRACT_TYPE_RULE[c.contractType]}</Text>
          {c.creatorMessage ? <Text style={styles.message}>“{c.creatorMessage}”</Text> : null}
        </View>

        {/* Result */}
        {showResult && (
          <>
            <Text style={styles.sectionLabel}>RESULT</Text>
            <View style={styles.card}>
              <Text style={styles.resultWinner}>
                {c.status === 'pushed' ? 'Push — stakes refunded' :
                  c.winnerId === c.creatorId ? `${c.creatorName} wins` :
                  c.winnerId === c.counterpartyId ? `${c.counterpartyName} wins` : 'Settled'}
              </Text>
              {rd.creator_score != null && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultName}>{c.creatorName}</Text>
                  <Text style={styles.resultScore}>
                    {rd.creator_score}{rd.creator_net != null ? `  (${Number(rd.creator_net) >= 0 ? '+' : ''}${rd.creator_net} vs line)` : ''}
                  </Text>
                </View>
              )}
              {rd.counterparty_score != null && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultName}>{c.counterpartyName}</Text>
                  <Text style={styles.resultScore}>
                    {rd.counterparty_score}{rd.counterparty_net != null ? `  (${Number(rd.counterparty_net) >= 0 ? '+' : ''}${rd.counterparty_net} vs line)` : ''}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Offer history */}
        {offers.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>NEGOTIATION ({offers.length})</Text>
            <View style={styles.card}>
              {offers.map((o: PvpOfferView, i) => (
                <View key={o.id} style={[styles.offerRow, i < offers.length - 1 && styles.offerBorder]}>
                  <View style={styles.offerHead}>
                    <Text style={styles.offerWho}>
                      #{o.offerNo} · {o.offeredByName}
                    </Text>
                    <Text style={styles.offerMark}>
                      {o.accepted ? 'ACCEPTED' : o.declined ? 'DECLINED' : o.superseded ? 'SUPERSEDED' : 'LIVE'}
                    </Text>
                  </View>
                  <Text style={styles.offerTerms}>
                    Stake {formatStakes(o.creatorStake, o.counterpartyStake)} · {o.gameNumber != null ? `Game ${o.gameNumber}` : 'Series'} · {CONTRACT_TYPE_LABEL[o.contractType] ?? o.contractType}
                  </Text>
                  {o.message ? <Text style={styles.offerMsg}>“{o.message}”</Text> : null}
                </View>
              ))}
            </View>
          </>
        )}

        {/* Ledger */}
        {ledger.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>LEDGER</Text>
            <View style={styles.card}>
              {ledger.map((e: PvpLedgerView, i) => (
                <View key={e.id} style={[styles.ledgerRow, i < ledger.length - 1 && styles.offerBorder]}>
                  <Text style={styles.ledgerType}>{LEDGER_LABEL[e.type] ?? e.type.toUpperCase()}</Text>
                  <Text style={[styles.ledgerAmt, { color: e.amount >= 0 ? colors.success : colors.danger }]}>
                    {e.amount >= 0 ? '+' : ''}{e.amount.toLocaleString()}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Admin note */}
        {c.adminNote ? (
          <>
            <Text style={styles.sectionLabel}>ADMIN NOTE</Text>
            <View style={styles.card}><Text style={styles.message}>{c.adminNote}</Text></View>
          </>
        ) : null}

        {/* Actions */}
        {(actions.canAccept || actions.canDecline || actions.canCounter || actions.canRematch) && (
          <View style={styles.actionStack}>
            {actions.canAccept && (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setAcceptOpen(true)} activeOpacity={0.7}>
                <Text style={styles.primaryBtnText}>Accept</Text>
              </TouchableOpacity>
            )}
            <View style={styles.actionRow}>
              {actions.canCounter && (
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCounterOpen(true)} activeOpacity={0.7}>
                  <Text style={styles.secondaryBtnText}>Counter</Text>
                </TouchableOpacity>
              )}
              {actions.canDecline && (
                <TouchableOpacity style={[styles.secondaryBtn, declining && styles.btnDisabled]} onPress={confirmDecline} disabled={declining} activeOpacity={0.7}>
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
              )}
            </View>
            {actions.canRematch && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('PvPCreate', { rematchOfId: c.id })}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryBtnText}>Rematch — Double or Nothing</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {acceptOpen && (
        <PvpAcceptModal challenge={c} viewerId={playerId} onClose={() => setAcceptOpen(false)} onDone={reload} />
      )}
      {counterOpen && (
        <PvpCounterModal challenge={c} viewerId={playerId} balance={balance} onClose={() => setCounterOpen(false)} onDone={reload} />
      )}
      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 8,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  matchup: { fontFamily: fonts.barlowCondensed, fontSize: 19, color: colors.text, fontWeight: '700', flex: 1, marginRight: 8 },
  statusBadge: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5 },

  termGrid: { flexDirection: 'row', gap: 8 },
  termCell: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.cardSm, padding: 12 },
  termLabel: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted },
  termValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 22, color: colors.text, marginTop: 2 },
  termValueSm: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 16, color: colors.text, marginTop: 4 },
  termValueAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 22, color: colors.accent, marginTop: 2 },

  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  metaText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3 },
  metaDivider: { color: colors.muted2 },
  sides: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text, marginTop: 10 },
  rule: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 12 },
  message: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, fontStyle: 'italic', lineHeight: 20, marginTop: 10 },

  sectionLabel: { fontFamily: fonts.barlowCondensed, fontSize: 13, letterSpacing: 2, color: colors.muted, marginTop: 14, marginBottom: 8 },

  resultWinner: { fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.accent, fontWeight: '700', marginBottom: 10 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 },
  resultName: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.text },
  resultScore: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted },

  offerRow: { paddingVertical: 10 },
  offerBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  offerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  offerWho: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.text },
  offerMark: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted },
  offerTerms: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, marginTop: 3 },
  offerMsg: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text, fontStyle: 'italic', marginTop: 4 },

  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  ledgerType: { fontFamily: fonts.barlowCondensed, fontSize: 13, letterSpacing: 0.5, color: colors.text },
  ledgerAmt: { fontFamily: fonts.barlowCondensed, fontSize: 15 },

  actionStack: { marginTop: 18, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
  secondaryBtn: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2, paddingVertical: 13, alignItems: 'center' },
  secondaryBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  declineText: { fontFamily: fonts.barlowCondensed, fontSize: 15, fontWeight: '700', color: colors.danger, letterSpacing: 0.5 },
  btnDisabled: { opacity: 0.4 },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.cardMd, borderWidth: 1, borderColor: colors.border, padding: 20, alignItems: 'center', margin: 16 },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted },
})
