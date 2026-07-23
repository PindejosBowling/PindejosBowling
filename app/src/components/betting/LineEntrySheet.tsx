import { useState } from 'react'
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { colors, fonts, radius, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import { useLinePreview, oddsForLine, type LinePreviewSource, type LineQuote } from '../../hooks/useLinePreview'

interface LineEntrySheetProps {
  // Sheet header: the subject ("Garrett Blinkhorn", "A + B + C").
  title: string
  // What's being counted: 'TOTAL PINS' / 'STRIKES' / … (shown in the preview).
  conditionLabel: string
  // 'GAME 2' / 'NIGHT' scope tag for the subtitle.
  scopeLabel?: string
  // Optional yardstick line under the band — e.g. the combo's group average,
  // so the typed value reads against expected production, not just the band.
  contextNote?: string
  // What the preview RPC prices: the pill's market or the combo member set.
  source: NonNullable<LinePreviewSource>
  // The value the editor opens on (staged pick / prior edit / seed rung).
  initialValue: number
  // Accept: the snapped value plus the quote that priced it — the caller owns
  // committing it (stage updates, price cache). Display-only pricing;
  // placement re-prices authoritatively (quote_tolerance).
  onAccept: (value: number, quote: LineQuote) => void
  onClose: () => void
}

// The value-entry sheet behind every value-first line: type the WHOLE number
// the bet should beat (the half-point line X.5 is implied — shown on the
// live-re-priced preview), see the acceptable band, Accept returns the chosen
// value to the board. The half-point grid is enforced by construction
// (integer + 0.5); the pricing/placement RPCs re-validate server-side.
// Replaces the inline pill TextInput (which fought the keyboard for the
// lower board).
// Conditional-mount contract: callers render `{editing && <LineEntrySheet/>}`
// so state resets between opens.
export default function LineEntrySheet({
  title,
  conditionLabel,
  scopeLabel,
  contextNote,
  source,
  initialValue,
  onAccept,
  onClose,
}: LineEntrySheetProps) {
  // The input traffics in WHOLE numbers — the .5 is implied and shown only on
  // the previewed line ("142" → the 142.5+ line: beat 142).
  const [text, setText] = useState(String(Math.floor(initialValue)))
  const parsed = parseInt(text, 10)
  const draft = isNaN(parsed) ? null : parsed + 0.5

  // Prices the draft as it changes (250ms debounce); a null draft prices the
  // seed rung, so the acceptable band is known even mid-erase.
  const { quote, loading } = useLinePreview(source, draft)

  const priced = draft != null && quote != null && quote.line === draft
  const odds = oddsForLine(quote, draft)
  const inBand =
    draft != null && quote != null && draft >= quote.minLine && draft <= quote.maxLine

  return (
    <BottomSheet
      title={title}
      subtitle={scopeLabel != null ? `${conditionLabel} · ${scopeLabel}` : conditionLabel}
      onClose={onClose}
      keyboardAvoiding
      footer={
        <Button
          label="Accept"
          size="lg"
          onPress={() => priced && odds != null && onAccept(draft, quote)}
          disabled={!priced || odds == null}
          style={styles.cta}
        />
      }
    >
      <View style={styles.body}>
        {/* The value input — the number the bettor intends to beat. */}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={t => setText(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          // No returnKeyType on iOS: RN pairs number pads + returnKeyType with
          // an auto "Done" accessory toolbar whose invisible spacer swallows
          // taps. Android's numeric keyboard has a real Done key.
          returnKeyType={Platform.OS === 'ios' ? undefined : 'done'}
        />

        {/* The acceptable band (from the quote; every quote carries it,
            whatever line it priced) — shown in the input's whole-number
            terms (the X.5 line ↔ typing X). */}
        <Text style={styles.range}>
          {quote != null
            ? `Acceptable: ${Math.floor(quote.minLine)} – ${Math.floor(quote.maxLine)}`
            : 'Finding the acceptable range…'}
        </Text>
        {contextNote != null && <Text style={styles.range}>{contextNote}</Text>}

        {/* The modified line, re-priced live as the input changes. */}
        <View style={styles.preview}>
          <Text style={styles.previewLine}>
            {draft != null ? `${draft.toFixed(1)}+ ${conditionLabel}` : '—'}
          </Text>
          <Text style={styles.previewOdds}>
            {odds != null ? fmtOdds(odds) : loading || !priced ? '…' : '—'}
          </Text>
        </View>
        {draft != null && quote != null && !inBand && (
          <Text style={styles.unavailable}>
            That line is outside the acceptable range
          </Text>
        )}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 8, gap: 10 },
  input: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 34,
    color: colors.text,
    textAlign: 'center',
    minWidth: 120,
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.cardSm,
  },
  range: { ...type.label, color: colors.muted },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
  },
  previewLine: { ...type.chip, color: colors.text },
  previewOdds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 16,
    color: colors.accent,
  },
  unavailable: { ...type.label, color: colors.gold },
  cta: { marginTop: 12 },
})
