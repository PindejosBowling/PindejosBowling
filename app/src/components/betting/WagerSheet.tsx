import { ReactNode } from 'react'
import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import WagerField from './WagerField'

interface WagerSheetProps {
  title: string
  // Title accent (gold for "special" custom lines).
  titleColor?: string
  // Context prepended to the odds line, ending in "· " — e.g. "LINE: 142.5 · ",
  // "ALL LEGS MUST WIN · ". The sheet always appends "PAYS ×odds".
  oddsPrefix?: string
  // Decimal odds of the pick/bundle — shown as the ×multiple and driving the
  // live "To win" preview (floor(wager × odds), the server's payout math).
  odds: number
  wager: string
  // Receives the raw text; the sheet has already stripped non-digits.
  onChangeWager: (wager: string) => void
  balance: number
  ctaLabel: string
  onSubmit: () => void
  // While placing: dismissal blocked, CTA spinning.
  busy?: boolean
  onClose: () => void
  // Bet-specific body above the wager input (pick toggle, leg list, …).
  children?: ReactNode
  // When an Energy Drink (odds_boost) is attached, the multiplier applied to
  // profit (payout − wager) — the House-funded bonus. Undefined = no boost. Drives
  // a highlighted, boosted "To win" preview that mirrors the server's settlement.
  boostPct?: number
}

// The shared bet-confirmation sheet: title → "… PAYS ×odds" → caller's body →
// wager input with a live to-win preview → the can't-cancel warning → CTA.
// One component behind the single, parlay, and special take flows — the screen
// owns the betting state and placement RPC; this owns the presentation.
// Built on BottomSheet — mount conditionally (`{thing && <WagerSheet …/>}`).
export default function WagerSheet({
  title,
  titleColor,
  oddsPrefix,
  odds,
  wager,
  onChangeWager,
  balance,
  ctaLabel,
  onSubmit,
  busy,
  onClose,
  children,
  boostPct,
}: WagerSheetProps) {
  return (
    <BottomSheet
      title={title}
      titleColor={titleColor}
      subtitle={`${oddsPrefix ?? ''}PAYS ×${odds.toFixed(odds % 1 === 0 ? 0 : 2)}`}
      onClose={onClose}
      busy={busy}
      keyboardAvoiding
      footer={
        <Button
          label={ctaLabel}
          size="lg"
          onPress={onSubmit}
          loading={busy}
          disabled={busy}
          style={styles.cta}
        />
      }
    >
      {children}
      <WagerField
        wager={wager}
        onChangeWager={onChangeWager}
        balance={balance}
        odds={odds}
        boostPct={boostPct}
      />
      <Text style={styles.warning}>⚠ Bets can't be canceled once placed.</Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  warning: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    marginTop: 12,
  },
  cta: { marginTop: 16 },
})
