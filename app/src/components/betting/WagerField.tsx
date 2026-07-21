import { Text, StyleSheet } from 'react-native'
import { colors, fonts, type } from '../../theme'
import PinAmountInput from '../ui/PinAmountInput'
import { formatPins } from '../../utils/formatting'

interface WagerFieldProps {
  wager: string
  // Receives the raw text; the field strips non-digits before calling.
  onChangeWager: (wager: string) => void
  balance: number
  // Decimal odds driving the live "To win" preview (floor(wager × odds)) — the
  // server's payout math.
  odds: number
  // When an Energy Drink (odds_boost) is attached, the multiplier applied to the
  // total payout (floor(payout × boostPct), paid on top). Undefined = no boost.
  // Drives a highlighted, boosted "To win" preview mirroring the server's settlement.
  boostPct?: number
  // Optional label override (defaults to "WAGER (pins)"). Compact hides the
  // balance/min hint (used in dense per-pick rows).
  label?: string
  compact?: boolean
}

// The shared wager input + live to-win preview. Extracted from WagerSheet so the
// single/parlay/special take sheets AND the unified BetSlip share one money-math
// surface (floor(wager × odds), plus the Energy Drink profit boost).
export default function WagerField({
  wager,
  onChangeWager,
  balance,
  odds,
  boostPct,
  label = 'WAGER (pins)',
  compact,
}: WagerFieldProps) {
  const wagerNum = parseInt(wager, 10)
  const payout = !isNaN(wagerNum) ? Math.floor(wagerNum * odds) : 0
  const boostBonus = boostPct != null && !isNaN(wagerNum) ? Math.floor(payout * boostPct) : 0
  const boosted = boostBonus > 0
  const toWin = payout + boostBonus

  return (
    <>
      <Text style={styles.wagerLabel}>{label}</Text>
      <PinAmountInput
        style={compact && styles.wagerInputCompact}
        variant="wager"
        value={wager}
        onChangeText={onChangeWager}
        placeholder={`10 – ${balance}`}
        maxLength={6}
      />
      <Text style={styles.wagerHint}>
        {!compact && `Balance: ${balance} pins  ·  Min: 10`}
        {!isNaN(wagerNum) ? `${compact ? '' : '  ·  '}To win: ` : ''}
        {!isNaN(wagerNum) && (
          <Text style={boosted ? styles.toWinBoosted : styles.toWin}>
            {formatPins(toWin)}{boosted ? ' ⚡️' : ''}
          </Text>
        )}
      </Text>
      {boosted && !compact && (
        <Text style={styles.boostNote}>
          Energy Drink ⚡️ doubles your total payout — {formatPins(payout)} payout + {formatPins(boostBonus)} bonus.
        </Text>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  wagerLabel: {
    ...type.label,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 6,
  },
  wagerInputCompact: { paddingVertical: 8, fontSize: 16 },
  wagerHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
  // The to-win amount gets the accent so the payoff reads at a glance.
  toWin: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.3,
  },
  // Boosted "To win" — gold to flag the Energy Drink's House-funded uplift.
  toWinBoosted: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.gold,
    letterSpacing: 0.3,
  },
  boostNote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.gold,
    marginTop: 4,
  },
})
