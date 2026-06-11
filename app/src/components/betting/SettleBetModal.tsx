import { useState } from 'react'
import { View, Text, TextInput, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { betMarkets } from '../../utils/supabase/db'
import type { BetView } from '../../hooks/usePinsinoData'

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

// over/under result from an actual score vs. the line.
function previewResult(value: string, line: number): string | null {
  if (value === '') return null
  const a = parseInt(value, 10)
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
    // Collect the unresolved legs. O/U legs need an entered score; moneyline legs
    // settle from the game's scores server-side (no input).
    const toSettle: { marketId: string; marketType: string; value?: number }[] = []
    for (let i = 0; i < bet.legs.length; i++) {
      const leg = bet.legs[i]
      if (leg.result != null) continue // already resolved — locked
      if (leg.marketType === 'over_under') {
        const a = parseInt(scores[i] ?? '', 10)
        if (isNaN(a) || a < 0 || a > 300) {
          showToast(`Enter a valid score (0–300) for ${leg.subjectName}`, 'error')
          return
        }
        toSettle.push({ marketId: leg.marketId, marketType: leg.marketType, value: a })
      } else {
        toSettle.push({ marketId: leg.marketId, marketType: leg.marketType })
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
        const { error } = item.marketType === 'over_under'
          ? await betMarkets.settle(item.marketId, item.value!)
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
      title={isParlay ? `Settle ${bet.legCount}-Leg Parlay` : `Settle — ${bet.subjectName} Game ${bet.gameNumber}`}
      subtitle={
        isParlay
          ? `${bet.bettorName} · enter each leg's actual score`
          : bet.marketType === 'over_under'
            ? `LINE: ${bet.line.toFixed(1)}`
            : 'Settles from game scores'
      }
      onClose={onClose}
      busy={settling}
      keyboardAvoiding
      bodyMaxHeight={360}
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
        const isOU = leg.marketType === 'over_under'
        const value = scores[i] ?? ''
        const preview = isOU ? previewResult(value, leg.line) : null
        return (
          <View key={i} style={[styles.legBlock, i > 0 && styles.legBlockBorder]}>
            <Text style={styles.legSubject}>
              {leg.subjectName} · {leg.pick?.toUpperCase()}
              {isOU ? ` ${leg.line.toFixed(1)}` : ''}
              {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
            </Text>
            {settled ? (
              <Text style={styles.legSettled}>
                Settled
                {leg.actualScore != null ? ` · actual ${leg.actualScore}` : ''}
                {leg.result ? ` (${leg.result.toUpperCase()})` : ''}
              </Text>
            ) : isOU ? (
              <>
                <TextInput
                  style={styles.wagerInput}
                  value={value}
                  onChangeText={v => setScores(s => ({ ...s, [i]: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  placeholder="0 – 300"
                  placeholderTextColor={colors.muted2}
                  maxLength={3}
                />
                <Text style={styles.wagerHint}>
                  {preview
                    ? `Result: ${preview} — resolves all bets on this line`
                    : `${leg.subjectName}'s actual score${leg.gameNumber != null ? ` for game ${leg.gameNumber}` : ''}`}
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
  wagerInput: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    letterSpacing: 1,
  },
  wagerHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
  placeBtn: { marginTop: 20 },
})
