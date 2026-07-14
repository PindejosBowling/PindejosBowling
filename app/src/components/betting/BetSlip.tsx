import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import WagerField from './WagerField'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import GoldenTicketToggle from '../auction/GoldenTicketToggle'
import WinnersCrutchToggle from '../auction/WinnersCrutchToggle'
import EnergyDrinkToggle from '../auction/EnergyDrinkToggle'
import { betLineSuffix } from '../../hooks/usePinsinoData'

// One individual pick staged in the slip — a chosen selection on a market.
// Combines with other picks into a parlay, or places as its own single.
export interface SlipPick {
  selectionId: string
  selectionKey: string
  selectionLabel: string
  marketId: string
  subjectName: string
  subjectPlayerId: string | null
  marketType: string
  gameNumber: number | null
  line: number | null
  statKey: string | null
  odds: number
}

// One special ("custom line") staged in the slip. A special is a pre-built,
// admin-curated bundle at fixed combined odds — it ALWAYS places as its own
// bet (carrying its custom_line_id tag), never merged as a leg into a parlay
// (that would break its identity/branding — see the design note in the screen).
export interface SlipSpecial {
  key: string          // instance id (React key + staging identity)
  lineId: string       // custom_lines.id — the durable bet tag
  title: string
  category: string     // 'special' | 'default'
  summary: string      // one-line leg summary for display
  selectionIds: string[]
  combinedOdds: number
  multiLeg: boolean
}

type SlipMode = 'singles' | 'parlay'

// A normalized placement request: at most one parlay (the combined picks) plus a
// list of standalone single bets (singles-mode picks and/or every special). The
// screen just loops this over bets.place. Items attach to the sole bet only.
export interface SlipSubmit {
  parlay: { selectionIds: string[]; stake: number } | null
  singles: { selectionIds: string[]; lineId?: string; stake: number }[]
  insure: boolean
  crutch: boolean
  boost: boolean
}

interface BetSlipProps {
  picks: SlipPick[]
  specials: SlipSpecial[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemovePick: (marketId: string) => void
  onRemoveSpecial: (key: string) => void
  onClear: () => void
  balance: number
  placing: boolean
  // Item inventory counts (0 hides the toggle) — oldest item is spent by the screen.
  ticketCount: number
  crutchCount: number
  boostCount: number
  boostPct: number
  onPlace: (submit: SlipSubmit) => void
}

function pickLabel(p: SlipPick): string {
  return (
    `${p.subjectName} · ${p.selectionLabel.toUpperCase()}` +
    betLineSuffix(p.marketType, p.line, p.statKey) +
    (p.gameNumber != null ? ` · G${p.gameNumber}` : '')
  )
}

// The unified bet slip: a persistent bar summarizing staged picks + specials
// that expands into a placement sheet. Individual picks combine (Singles /
// Parlay); each special always places as its own tagged bet. Presentational
// over the screen's slip state; the screen owns the placement RPC + reload.
// Mount whenever `picks.length + specials.length > 0`.
export default function BetSlip({
  picks,
  specials,
  open,
  onOpenChange,
  onRemovePick,
  onRemoveSpecial,
  onClear,
  balance,
  placing,
  ticketCount,
  crutchCount,
  boostCount,
  boostPct,
  onPlace,
}: BetSlipProps) {
  const count = picks.length + specials.length
  const multiPicks = picks.length > 1
  const [mode, setMode] = useState<SlipMode>('parlay')
  const [parlayWager, setParlayWager] = useState('')
  const [singleWagers, setSingleWagers] = useState<Record<string, string>>({})
  const [specialWagers, setSpecialWagers] = useState<Record<string, string>>({})
  const [insure, setInsure] = useState(false)
  const [crutch, setCrutch] = useState(false)
  const [boost, setBoost] = useState(false)

  // Reset ephemeral input + item state on each open — spending a scarce item is
  // always a deliberate act, and a fresh sheet shouldn't carry stale stakes.
  useEffect(() => {
    if (open) {
      setParlayWager('')
      setSingleWagers({})
      setSpecialWagers({})
      setInsure(false)
      setCrutch(false)
      setBoost(false)
      setMode(picks.length > 1 ? 'parlay' : 'singles')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Picks parlay only when there are 2+ and parlay is chosen; specials always
  // stand alone. The resulting bet count drives item eligibility.
  const parlayPicks = multiPicks && mode === 'parlay'
  const pickBets = parlayPicks ? (picks.length >= 2 ? 1 : 0) : picks.length
  const totalBets = pickBets + specials.length

  // Items attach to exactly ONE bet, so they're offered only when the slip
  // resolves to a single bet. A crutch additionally needs that bet to be
  // multi-leg (a parlay of picks, or a multi-leg special).
  const oneBet = totalBets === 1
  const oneBetMultiLeg =
    oneBet &&
    ((parlayPicks && specials.length === 0 && picks.length >= 2) ||
      (specials.length === 1 && picks.length === 0 && specials[0].multiLeg))

  const parlayOdds = useMemo(() => Math.pow(2, picks.length), [picks.length])

  const specialsTotal = specials.reduce((s, sp) => s + (parseInt(specialWagers[sp.key] ?? '', 10) || 0), 0)
  const singlesPickTotal = picks.reduce((s, p) => s + (parseInt(singleWagers[p.marketId] ?? '', 10) || 0), 0)
  const parlayNum = parseInt(parlayWager, 10)
  const grandTotal = specialsTotal + (parlayPicks ? (parlayNum || 0) : singlesPickTotal)

  const specialsValid = specials.every(sp => {
    const n = parseInt(specialWagers[sp.key] ?? '', 10)
    return !isNaN(n) && n >= 10
  })
  const picksValid = parlayPicks
    ? !isNaN(parlayNum) && parlayNum >= 10
    : picks.every(p => {
        const n = parseInt(singleWagers[p.marketId] ?? '', 10)
        return !isNaN(n) && n >= 10
      })
  const canPlace = count > 0 && specialsValid && picksValid && grandTotal <= balance

  function submit() {
    if (!canPlace) return
    const singles: SlipSubmit['singles'] = []
    if (!parlayPicks) {
      for (const p of picks) singles.push({ selectionIds: [p.selectionId], stake: parseInt(singleWagers[p.marketId], 10) })
    }
    for (const sp of specials) singles.push({ selectionIds: sp.selectionIds, lineId: sp.lineId, stake: parseInt(specialWagers[sp.key], 10) })
    onPlace({
      parlay: parlayPicks ? { selectionIds: picks.map(p => p.selectionId), stake: parlayNum } : null,
      singles,
      insure: oneBet && insure,
      crutch: oneBetMultiLeg && crutch,
      boost: oneBet && boost,
    })
  }

  const ctaLabel = totalBets > 1 ? `Place ${totalBets} Bets` : 'Place Bet'
  const showZoneLabels = specials.length > 0 && picks.length > 0

  const subtitle =
    totalBets > 1
      ? `${totalBets} BETS · ${grandTotal || 0} PINS`
      : parlayPicks
        ? `${picks.length}-LEG PARLAY · ALL MUST WIN · PAYS ×${parlayOdds}`
        : specials.length === 1
          ? `SPECIAL · PAYS ×${specials[0].combinedOdds.toFixed(specials[0].combinedOdds % 1 === 0 ? 0 : 2)}`
          : 'SINGLE BET'

  return (
    <>
      {/* Collapsed summary bar */}
      <View style={styles.bar}>
        <TouchableOpacity style={styles.barInfo} onPress={() => onOpenChange(true)} activeOpacity={0.7}>
          <Text style={styles.barTitle}>
            BET SLIP · {count} {count === 1 ? 'PICK' : 'PICKS'}
          </Text>
          <Text style={styles.barSub} numberOfLines={1}>
            {[
              ...specials.map(s => s.title),
              ...picks.map(p => `${p.subjectName} ${p.selectionLabel.toUpperCase()}`),
            ].join(' · ')}
          </Text>
        </TouchableOpacity>
        <Button variant="ghost" label="Clear" onPress={onClear} style={styles.barClear} />
        <Button label="Review" onPress={() => onOpenChange(true)} style={styles.barReview} />
      </View>

      {/* Expanded placement sheet */}
      {open && (
        <BottomSheet
          title="Bet Slip"
          subtitle={subtitle}
          onClose={() => onOpenChange(false)}
          busy={placing}
          keyboardAvoiding
          footer={
            <Button
              label={ctaLabel}
              size="lg"
              onPress={submit}
              loading={placing}
              disabled={placing || !canPlace}
              style={styles.cta}
            />
          }
        >
          {/* ── Specials (each its own bet) ── */}
          {specials.length > 0 && (
            <View style={styles.zone}>
              {showZoneLabels && <Text style={styles.zoneLabel}>SPECIALS</Text>}
              {specials.map(sp => (
                <View key={sp.key} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={[styles.specialTitle, sp.category === 'special' && styles.specialTitleGold]}>
                      {sp.title} · ×{sp.combinedOdds.toFixed(sp.combinedOdds % 1 === 0 ? 0 : 2)}
                    </Text>
                    <Text style={styles.specialSummary} numberOfLines={2}>{sp.summary}</Text>
                    <View style={styles.wager}>
                      <WagerField
                        wager={specialWagers[sp.key] ?? ''}
                        onChangeWager={v => setSpecialWagers(s => ({ ...s, [sp.key]: v }))}
                        balance={balance}
                        odds={sp.combinedOdds}
                        boostPct={oneBet && boost ? boostPct : undefined}
                        label="STAKE (pins)"
                        compact
                      />
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => onRemoveSpecial(sp.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.remove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ── Picks (singles / parlay) ── */}
          {picks.length > 0 && (
            <View style={styles.zone}>
              {showZoneLabels && <Text style={styles.zoneLabel}>PICKS</Text>}
              {multiPicks && (
                <View style={styles.modeRow}>
                  <ToggleGroup
                    variant="bar"
                    options={[{ key: 'singles', label: 'Singles' }, { key: 'parlay', label: 'Parlay' }]}
                    value={mode}
                    onChange={(m: SlipMode) => setMode(m)}
                  />
                </View>
              )}
              {picks.map(p => (
                <View key={p.marketId} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={styles.pickText} numberOfLines={2}>{pickLabel(p)}</Text>
                    {!parlayPicks && (
                      <View style={styles.wager}>
                        <WagerField
                          wager={singleWagers[p.marketId] ?? ''}
                          onChangeWager={v => setSingleWagers(s => ({ ...s, [p.marketId]: v }))}
                          balance={balance}
                          odds={p.odds}
                          boostPct={oneBet && boost ? boostPct : undefined}
                          label="STAKE (pins)"
                          compact
                        />
                      </View>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => onRemovePick(p.marketId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.remove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {parlayPicks && (
                <WagerField
                  wager={parlayWager}
                  onChangeWager={setParlayWager}
                  balance={balance}
                  odds={parlayOdds}
                  boostPct={oneBet && boost ? boostPct : undefined}
                />
              )}
            </View>
          )}

          {/* Item toggles — only when the slip resolves to a single bet. */}
          {oneBet ? (
            <>
              <GoldenTicketToggle ticketCount={ticketCount} enabled={insure} onToggle={setInsure} disabled={placing} />
              {oneBetMultiLeg && (
                <WinnersCrutchToggle crutchCount={crutchCount} enabled={crutch} onToggle={setCrutch} disabled={placing} />
              )}
              <EnergyDrinkToggle boostCount={boostCount} enabled={boost} onToggle={setBoost} disabled={placing} />
            </>
          ) : (
            (ticketCount > 0 || boostCount > 0) && (
              <Text style={styles.itemNote}>
                Place a bet on its own to attach a Golden Ticket or Energy Drink.
              </Text>
            )
          )}

          {count > 0 && grandTotal > balance && (
            <Text style={styles.warning}>Total stake exceeds your balance.</Text>
          )}
          <TermsBlock terms={TERMS.betSlip} heading="SETTLEMENT" />
          <Text style={styles.warning}>⚠ Bets can't be canceled once placed.</Text>
        </BottomSheet>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  // Collapsed sticky bar (mirrors the old parlay slipBar footprint).
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  barInfo: { flex: 1 },
  barTitle: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  barSub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  barClear: { paddingHorizontal: 8, paddingVertical: 8 },
  barReview: { paddingHorizontal: 16, paddingVertical: 10 },

  zone: { marginBottom: 6 },
  zoneLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 4,
  },
  modeRow: { marginBottom: 12 },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  rowMain: { flex: 1 },
  pickText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  specialTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 0.3,
  },
  specialTitleGold: { color: colors.gold },
  specialSummary: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  wager: { marginTop: 2 },
  remove: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.danger,
    marginTop: 2,
  },
  itemNote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.muted,
    marginTop: 10,
  },
  warning: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    marginTop: 12,
  },
  cta: { marginTop: 16 },
})
