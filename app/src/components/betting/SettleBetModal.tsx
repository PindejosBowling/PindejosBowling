import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PinAmountInput from '../ui/PinAmountInput'
import { useUiStore } from '../../stores/uiStore'
import { betMarkets } from '../../utils/supabase/db'
import { betLineSuffix, STAT_LABELS, type BetView } from '../../hooks/usePinsinoData'

interface SettleBetModalProps {
  // The bet to settle. Each leg has its own market (over_under is one market per
  // player×game), and settling a market resolves *every* bet on it. A single is
  // just the one-leg case; a parlay settles all its legs and finalizes once the
  // last lands. Mount conditionally (`{bet && <SettleBetModal …/>}`) so the
  // inputs reset between opens.
  bet: BetView
  onClose: () => void
  onSettled: () => void
}

// Sanity ceiling for the entered value: a single player game caps at 300;
// aggregates (night totals, team pinfall) just get a generous bound.
function valueCap(marketType: string, gameNumber: number | null): number {
  return marketType === 'over_under' && gameNumber != null ? 300 : 9999
}

// over/under result from an actual value vs. the line (decimals allowed —
// stat props settle on values like 62.5 clean% / 7.8 first-ball avg).
function previewResult(value: string, line: number): string | null {
  if (value === '') return null
  const a = parseFloat(value)
  if (isNaN(a)) return null
  return a > line ? 'OVER' : a < line ? 'UNDER' : 'PUSH'
}

// Admin manual settlement (settle_market RPC, idempotent). One score input per
// leg; already-settled legs (a market resolved by another bet or week archive)
// show locked. Settling each leg's market pays out every bet on that line and,
// for a parlay, finalizes the bet once the last leg lands.
export default function SettleBetModal({ bet, onClose, onSettled }: SettleBetModalProps) {
  const { showToast } = useUiStore()
  // Per-leg actual-score inputs, keyed by leg index.
  const [scores, setScores] = useState<Record<number, string>>({})
  const [settling, setSettling] = useState(false)

  const isParlay = bet.legCount > 1

  async function settle() {
    // Collect the unresolved legs. Every value-graded market (O/U, stat prop,
    // team prop) needs an entered value (this is the admin escape hatch —
    // systematic settlement is the archive / "Confirm LaneTalk Data" rails);
    // only moneyline legs settle from the game's scores server-side (no input).
    const toSettle: { marketId: string; marketType: string; value?: number }[] = []
    for (let i = 0; i < bet.legs.length; i++) {
      const leg = bet.legs[i]
      if (leg.result != null) continue // already resolved — locked
      if (leg.marketType === 'moneyline') {
        toSettle.push({ marketId: leg.marketId, marketType: leg.marketType })
      } else {
        const a = leg.marketType === 'prop' ? parseFloat(scores[i] ?? '') : parseInt(scores[i] ?? '', 10)
        const max = valueCap(leg.marketType, leg.gameNumber)
        if (isNaN(a) || a < 0 || a > max) {
          showToast(`Enter a valid value (0–${max}) for ${leg.subjectName}`, 'error')
          return
        }
        toSettle.push({ marketId: leg.marketId, marketType: leg.marketType, value: a })
      }
    }

    if (toSettle.length === 0) {
      showToast('Nothing left to settle on this bet', 'error')
      return
    }

    setSettling(true)
    try {
      // Settle each leg's market in turn. Both RPCs are idempotent, so a leg
      // already resolved by an earlier call is a no-op; the parlay finalizes
      // automatically as its last leg lands. Moneyline derives its winner from the
      // game scores (errors if none recorded yet).
      for (const item of toSettle) {
        const { error } = item.value != null
          ? await betMarkets.settle(item.marketId, item.value)
          : await betMarkets.settleMoneyline(item.marketId)
        if (error) { showToast(error.message, 'error'); return }
      }
      showToast(isParlay ? 'Parlay settled' : 'Bet settled', 'success')
      onSettled()
      onClose()
    } catch {
      showToast('Failed to settle bet', 'error')
    } finally {
      setSettling(false)
    }
  }

  return (
    <BottomSheet
      title={isParlay
        ? `Settle ${bet.legCount}-Leg Parlay`
        : `Settle — ${bet.subjectName}${bet.gameNumber != null ? ` Game ${bet.gameNumber}` : ''}`}
      subtitle={
        isParlay
          ? `${bet.bettorName} · enter each leg's actual score`
          : bet.marketType === 'over_under'
            ? `LINE: ${bet.line.toFixed(1)}`
            : bet.marketType === 'prop' || bet.marketType === 'team_prop'
              ? `${bet.statKey ? `${(STAT_LABELS[bet.statKey] ?? bet.statKey).toUpperCase()} · ` : ''}LINE: ${bet.line.toFixed(1)}`
              : 'Settles from game scores'
      }
      onClose={onClose}
      busy={settling}
      keyboardAvoiding
      footer={
        <Button
          label={isParlay ? 'Settle Parlay' : 'Settle Bet'}
          size="lg"
          onPress={settle}
          loading={settling}
          disabled={settling}
          style={styles.placeBtn}
        />
      }
    >
      {bet.legs.map((leg, i) => {
        const settled = leg.result != null
        const isProp = leg.marketType === 'prop'
        // Every value-graded market takes a manually entered value — only
        // moneyline settles input-free. Props allow decimals (clean% /
        // first-ball avg); stat-carrying legs name the stat in the hint.
        const needsValue = leg.marketType !== 'moneyline'
        const statLabel = leg.statKey ? STAT_LABELS[leg.statKey] ?? leg.statKey : null
        const cap = valueCap(leg.marketType, leg.gameNumber)
        const value = scores[i] ?? ''
        const preview = needsValue ? previewResult(value, leg.line) : null
        return (
          <View key={i} style={[styles.legBlock, i > 0 && styles.legBlockBorder]}>
            <Text style={styles.legSubject}>
              {leg.subjectName} · {leg.pick?.toUpperCase()}
              {betLineSuffix(leg.marketType, leg.line, leg.statKey)}
              {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
            </Text>
            {settled ? (
              <Text style={styles.legSettled}>
                Settled
                {leg.actualScore != null ? ` · actual ${leg.actualScore}` : ''}
                {leg.result ? ` (${leg.result.toUpperCase()})` : ''}
              </Text>
            ) : needsValue ? (
              <>
                <PinAmountInput
                  variant="wager"
                  value={value}
                  onChangeText={v => setScores(s => ({ ...s, [i]: v }))}
                  // Props accept one decimal point; O/U stays integer-only.
                  allowDecimal={isProp}
                  placeholder={`0 – ${cap}`}
                  maxLength={isProp ? 5 : 4}
                />
                <Text style={styles.wagerHint}>
                  {preview
                    ? `Result: ${preview} — resolves all bets on this line`
                    : `${leg.subjectName}'s actual ${statLabel ? statLabel.toLowerCase() : leg.gameNumber != null ? 'score' : 'total pins'}${leg.gameNumber != null ? ` for game ${leg.gameNumber}` : ' for the night'}`}
                </Text>
              </>
            ) : (
              <Text style={styles.wagerHint}>
                Winner is the higher combined team score for game {leg.gameNumber}.
                Resolves from entered scores.
              </Text>
            )}
          </View>
        )
      })}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  legBlock: { paddingVertical: 14 },
  legBlockBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  legSubject: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  legSettled: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.success,
  },
  wagerHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
  placeBtn: { marginTop: 20 },
})
