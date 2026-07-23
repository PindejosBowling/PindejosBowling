import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, PanResponder, StyleSheet, Platform } from 'react-native'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { colors, fonts, radius, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import { betMarkets } from '../../utils/supabase/db'
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

// Decorative tick count on the dial face — evenly spread across whatever the
// band happens to be (they mark position, not value), every 5th one taller.
const DIAL_TICKS = 31

// The UI won't let the dial roam past the line paying this multiple (×100).
// Long-tail lines price far higher server-side (no odds ceiling — see
// odds-engine.md), but a value that pays 400× is noise on a dial; we clamp the
// interactive max to the richest line still paying ≤ ×100.
const PAY_CAP = 100

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

  // ── The value dial ────────────────────────────────────────────────
  // A drag gauge whose FULL width spans the whole acceptable band, so a given
  // finger travel always covers the same FRACTION of the range — turning it a
  // little has the same "impact" whether the band is 8 pins wide or 80. The
  // band is tied to the source (not the requested line), so its extent stays
  // fixed while the value re-prices. Whole numbers only (the .5 is implied).
  const bandMin = quote != null ? Math.floor(quote.minLine) : null
  const bandMax = quote != null ? Math.floor(quote.maxLine) : null
  const hasBand = bandMin != null && bandMax != null && bandMax > bandMin

  // The interactive ceiling: the highest whole line still paying ≤ ×100. Found
  // once per source by binary search over the band (odds rise monotonically
  // with the line) — null until resolved, so the dial opens on the full band
  // and tightens when the cap lands. Falls back to the band max if the whole
  // band pays under the cap (or the probe fails).
  const [oddsCapMax, setOddsCapMax] = useState<number | null>(null)
  useEffect(() => {
    if (!hasBand) return
    let cancelled = false
    const oddsAt = async (whole: number): Promise<number | null> => {
      const line = whole + 0.5
      const { data, error } = source.kind === 'market'
        ? await betMarkets.priceMarketLine(source.marketId, line)
        : await betMarkets.priceComboLine(
            source.memberIds, source.stat, source.seasonId, source.nGames,
            source.weekId, source.gameNumber, line,
          )
      if (error || !data || typeof data !== 'object') return null
      const o = (data as Record<string, unknown>).odds
      return o == null ? null : Number(o)
    }
    ;(async () => {
      // Fast path: if the top of the band already pays ≤ cap, nothing to clamp.
      const top = await oddsAt(bandMax!)
      if (cancelled) return
      if (top != null && top <= PAY_CAP) { setOddsCapMax(bandMax!); return }
      let lo = bandMin!, hi = bandMax!, ans = bandMin!
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const o = await oddsAt(mid)
        if (cancelled) return
        if (o != null && o <= PAY_CAP) { ans = mid; lo = mid + 1 } else hi = mid - 1
      }
      setOddsCapMax(ans)
    })()
    return () => { cancelled = true }
  }, [hasBand, bandMin, bandMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // The effective (UI-interactive) max — the odds cap when it's tighter than
  // the band and still leaves room to move; otherwise the band max.
  const effMax =
    hasBand
      ? oddsCapMax != null && oddsCapMax > bandMin! && oddsCapMax < bandMax!
        ? oddsCapMax
        : bandMax!
      : null

  // Keep typed entry inside the same ceiling as the dial: clamp anything above
  // the ×100 line back down. Runs when the cap resolves late (the dial opens on
  // the full band, so a value typed before the probe lands still gets pulled in).
  useEffect(() => {
    if (effMax != null && !isNaN(parsed) && parsed > effMax) setText(String(effMax))
  }, [effMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const curVal = isNaN(parsed) ? Math.floor(initialValue) : parsed
  const dialVal = hasBand ? Math.min(effMax!, Math.max(bandMin!, curVal)) : curVal
  const frac = hasBand ? (dialVal - bandMin!) / (effMax! - bandMin!) : 0
  // The book's forecast (seed) anchor, in the input's whole-number terms —
  // the middle quick-set button.
  const forecastVal = hasBand ? Math.min(effMax!, Math.max(bandMin!, Math.floor(quote!.seedLine))) : null

  // Latest geometry/value read at gesture time by the (once-created)
  // PanResponder — refs so the handlers always see current numbers without
  // re-creating the responder.
  const [trackW, setTrackW] = useState(0)
  const trackWRef = useRef(0)
  const geomRef = useRef({ min: 0, range: 1 })
  const dialValRef = useRef(0)
  const startValRef = useRef(0)
  trackWRef.current = trackW
  geomRef.current = { min: bandMin ?? 0, range: hasBand ? effMax! - bandMin! : 1 }
  dialValRef.current = dialVal

  const dial = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Anchor to the value we started on; the drag applies a delta from there,
      // so re-grabbing anywhere on the dial never jumps the value.
      onPanResponderGrant: () => { startValRef.current = dialValRef.current },
      onPanResponderMove: (_e, g) => {
        const { min, range } = geomRef.current
        const w = trackWRef.current
        if (w <= 0 || range <= 0) return
        const next = Math.round(startValRef.current + (g.dx / w) * range)
        setText(String(Math.min(min + range, Math.max(min, next))))
      },
    }),
  ).current

  return (
    <BottomSheet
      title={title}
      subtitle={scopeLabel != null ? `${conditionLabel} · ${scopeLabel}` : conditionLabel}
      onClose={onClose}
      keyboardAvoiding
      // The payout multiple, prominent in the top-right so the player always
      // sees what this line pays as they move it (stake is entered in the slip).
      headerRight={
        <View style={styles.payout}>
          <Text style={styles.payoutLabel}>PAYS</Text>
          <Text style={styles.payoutValue}>
            {odds != null ? fmtOdds(odds) : loading || !priced ? '…' : '—'}
          </Text>
        </View>
      }
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
        {/* The value entry — the bettor types a WHOLE number; the field always
            shows the implied ".5" appended (so "142" reads "142.5"), because
            lines live on the half-point grid. The number stays the editable
            part; the ".5" is a fixed suffix inside the same underlined box, and
            the stat name sits alongside → "142.5 TOTAL PINS" on one row. Tap the
            number to type; the keyboard stays closed until then (no autoFocus)
            so the dial below is the primary, calmer way to pick. */}
        <View style={styles.entryRow}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={t => {
                const digits = t.replace(/[^0-9]/g, '')
                if (digits === '') { setText(''); return }
                const n = parseInt(digits, 10)
                // Enforce the ×100 ceiling on typed entry too (min stays unclamped
                // so partial numbers can be typed; below-band is caught at Accept).
                setText(effMax != null && n > effMax ? String(effMax) : digits)
              }}
              keyboardType="number-pad"
              selectTextOnFocus
              // No returnKeyType on iOS: RN pairs number pads + returnKeyType with
              // an auto "Done" accessory toolbar whose invisible spacer swallows
              // taps. Android's numeric keyboard has a real Done key.
              returnKeyType={Platform.OS === 'ios' ? undefined : 'done'}
            />
            <Text style={styles.inputHalf}>.5</Text>
          </View>
          <Text style={styles.entryStat}>{conditionLabel}</Text>
        </View>

        {/* The value dial — drag anywhere along it to change the number above.
            Its full width IS the whole band, so the same drag distance always
            moves the same fraction of the range. The input stays tappable for
            direct entry. */}
        {hasBand ? (
          <View style={styles.dialWrap}>
            <View
              style={styles.dial}
              onLayout={e => setTrackW(e.nativeEvent.layout.width)}
              {...dial.panHandlers}
            >
              <View pointerEvents="none" style={[styles.dialFill, { width: frac * trackW }]} />
              <View pointerEvents="none" style={styles.ticks}>
                {Array.from({ length: DIAL_TICKS }).map((_, i) => (
                  <View key={i} style={[styles.tick, i % 5 === 0 && styles.tickMajor]} />
                ))}
              </View>
              <View pointerEvents="none" style={[styles.caret, { left: frac * trackW - 1 }]} />
            </View>
            {/* Quick-set the value to the band ends or the book's forecast. */}
            <View style={styles.quickRow}>
              {([
                { label: 'MIN', value: bandMin! },
                { label: 'FORECAST', value: forecastVal! },
                { label: 'MAX', value: effMax! },
              ] as const).map(q => {
                const on = q.value === dialVal
                return (
                  <TouchableOpacity
                    key={q.label}
                    style={[styles.quickBtn, on && styles.quickBtnOn]}
                    onPress={() => setText(String(q.value))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.quickBtnLabel}>{q.label}</Text>
                    <Text style={[styles.quickBtnVal, on && styles.quickBtnValOn]}>{q.value}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        ) : (
          <Text style={styles.range}>Finding the acceptable range…</Text>
        )}
        {contextNote != null && <Text style={styles.range}>{contextNote}</Text>}

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
  // The value entry (number + fixed ".5") and the stat name on one row.
  entryRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  // The underlined field wrapping the editable number and its ".5" suffix so
  // the pair reads as a single value ("142.5").
  inputBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.cardSm,
  },
  input: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 34,
    color: colors.text,
    textAlign: 'right',
    minWidth: 64,
    padding: 0,
  },
  // The always-on ".5" — same type as the number so they read continuously.
  inputHalf: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 34,
    color: colors.text,
  },
  entryStat: { ...type.label, color: colors.muted, marginBottom: 6 },
  // The value dial — full-width drag gauge (its span IS the whole band).
  dialWrap: { alignSelf: 'stretch', marginTop: 4 },
  dial: {
    height: 48,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  // Filled portion from the low end up to the current value.
  dialFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accentDim,
  },
  // Evenly spread tick marks (position markers, not values).
  ticks: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  tick: { width: 1, height: 10, backgroundColor: colors.border2 },
  tickMajor: { height: 18, backgroundColor: colors.muted },
  // The current-value pointer.
  caret: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.accent,
  },
  // Quick-set buttons under the dial — min / forecast / max.
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
  },
  quickBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  quickBtnLabel: { ...type.label, color: colors.muted, marginBottom: 1 },
  quickBtnVal: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 16,
    color: colors.text,
  },
  quickBtnValOn: { color: colors.accent },
  range: { ...type.label, color: colors.muted },
  // The prominent payout multiple in the sheet's top-right corner.
  payout: { alignItems: 'flex-end' },
  payoutLabel: { ...type.label, color: colors.muted, marginBottom: 1 },
  payoutValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 30,
    color: colors.accent,
    letterSpacing: 0.3,
  },
  unavailable: { ...type.label, color: colors.gold },
  cta: { marginTop: 12 },
})
