import { ReactNode } from 'react'
import { Text, TextInput, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

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
}: WagerSheetProps) {
  const wagerNum = parseInt(wager, 10)

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
      <Text style={styles.wagerLabel}>WAGER (pins)</Text>
      <TextInput
        style={styles.wagerInput}
        value={wager}
        onChangeText={v => onChangeWager(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder={`10 – ${balance}`}
        placeholderTextColor={colors.muted2}
        maxLength={6}
      />
      <Text style={styles.wagerHint}>
        Balance: {balance} pins  ·  Min: 10
        {!isNaN(wagerNum)
          ? `  ·  To win: ${Math.floor(wagerNum * odds).toLocaleString()}`
          : ''}
      </Text>
      <Text style={styles.warning}>⚠ Bets can't be canceled once placed.</Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  wagerLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
    marginTop: 6,
    marginBottom: 6,
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
  warning: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    marginTop: 12,
  },
  cta: { marginTop: 16 },
})
