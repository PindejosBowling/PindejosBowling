import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import WagerField from './WagerField'
import GoldenTicketToggle from '../auction/GoldenTicketToggle'
import WinnersCrutchToggle from '../auction/WinnersCrutchToggle'
import EnergyDrinkToggle from '../auction/EnergyDrinkToggle'
import { betLineSuffix } from '../../hooks/usePinsinoData'

// One pick staged in the unified slip. Generic over market_type — a pick is a
// chosen selection on a market. Mirrors the fields the board already carries.
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

type SlipMode = 'singles' | 'parlay'

// Concrete item choices resolved from the toggles, handed back to the screen
// (which maps them onto item ids and calls the placement RPC).
export interface SinglesSubmit {
  entries: { pick: SlipPick; stake: number }[]
  insure: boolean
  boost: boolean
}
export interface ParlaySubmit {
  stake: number
  insure: boolean
  crutch: boolean
  boost: boolean
}

interface BetSlipProps {
  picks: SlipPick[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemovePick: (marketId: string) => void
  onClear: () => void
  balance: number
  placing: boolean
  // Item inventory counts (0 hides the toggle) — oldest item is spent by the screen.
  ticketCount: number
  crutchCount: number
  boostCount: number
  boostPct: number
  onPlaceSingles: (submit: SinglesSubmit) => void
  onPlaceParlay: (submit: ParlaySubmit) => void
}

function pickLabel(p: SlipPick): string {
  return (
    `${p.subjectName} · ${p.selectionLabel.toUpperCase()}` +
    betLineSuffix(p.marketType, p.line, p.statKey) +
    (p.gameNumber != null ? ` · G${p.gameNumber}` : '')
  )
}

// The unified bet slip: a persistent bottom bar summarizing staged picks that
// expands into a placement sheet. One pick → a single; 2+ → Singles (each its
// own bet, per-pick stake) or Parlay (one combined-odds bet). Presentational
// over the screen's slip state; the screen owns the placement RPC + reload.
// Mount it whenever `picks.length > 0`.
export default function BetSlip({
  picks,
  open,
  onOpenChange,
  onRemovePick,
  onClear,
  balance,
  placing,
  ticketCount,
  crutchCount,
  boostCount,
  boostPct,
  onPlaceSingles,
  onPlaceParlay,
}: BetSlipProps) {
  const multi = picks.length > 1
  const [mode, setMode] = useState<SlipMode>('parlay')
  const [parlayWager, setParlayWager] = useState('')
  const [singleWagers, setSingleWagers] = useState<Record<string, string>>({})
  const [insure, setInsure] = useState(false)
  const [crutch, setCrutch] = useState(false)
  const [boost, setBoost] = useState(false)

  // Reset ephemeral input + item state on each open — spending a scarce item is
  // always a deliberate act, and a fresh sheet shouldn't carry stale stakes.
  useEffect(() => {
    if (open) {
      setParlayWager('')
      setSingleWagers({})
      setInsure(false)
      setCrutch(false)
      setBoost(false)
      setMode(picks.length > 1 ? 'parlay' : 'singles')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // A single staged pick is always a single; only offer the switch for 2+.
  const effectiveMode: SlipMode = multi ? mode : 'singles'
  const parlayOdds = useMemo(() => Math.pow(2, picks.length), [picks.length])

  // Items attach to exactly one bet, so they're only offered when the slip
  // resolves to ONE bet: a lone single, or a parlay. Multi-single hides them.
  const oneBet = effectiveMode === 'parlay' || picks.length === 1

  const singlesTotal = useMemo(
    () => picks.reduce((s, p) => s + (parseInt(singleWagers[p.marketId] ?? '', 10) || 0), 0),
    [picks, singleWagers],
  )

  const parlayNum = parseInt(parlayWager, 10)
  const canPlace =
    effectiveMode === 'parlay'
      ? picks.length >= 2 && !isNaN(parlayNum) && parlayNum >= 10 && parlayNum <= balance
      : picks.length >= 1 &&
        picks.every(p => {
          const n = parseInt(singleWagers[p.marketId] ?? '', 10)
          return !isNaN(n) && n >= 10
        }) &&
        singlesTotal <= balance

  function submit() {
    if (!canPlace) return
    if (effectiveMode === 'parlay') {
      onPlaceParlay({ stake: parlayNum, insure, crutch, boost })
    } else {
      const entries = picks.map(p => ({ pick: p, stake: parseInt(singleWagers[p.marketId], 10) }))
      onPlaceSingles({ entries, insure: oneBet && insure, boost: oneBet && boost })
    }
  }

  const ctaLabel =
    effectiveMode === 'singles' && multi ? `Place ${picks.length} Bets` : 'Place Bet'

  return (
    <>
      {/* Collapsed summary bar */}
      <View style={styles.bar}>
        <TouchableOpacity style={styles.barInfo} onPress={() => onOpenChange(true)} activeOpacity={0.7}>
          <Text style={styles.barTitle}>
            BET SLIP · {picks.length} {picks.length === 1 ? 'PICK' : 'PICKS'}
          </Text>
          <Text style={styles.barSub} numberOfLines={1}>
            {picks.map(p => `${p.subjectName} ${p.selectionLabel.toUpperCase()}`).join(' · ')}
          </Text>
        </TouchableOpacity>
        <Button variant="ghost" label="Clear" onPress={onClear} style={styles.barClear} />
        <Button label="Review" onPress={() => onOpenChange(true)} style={styles.barReview} />
      </View>

      {/* Expanded placement sheet */}
      {open && (
        <BottomSheet
          title="Bet Slip"
          subtitle={
            effectiveMode === 'parlay'
              ? `${picks.length}-LEG PARLAY · ALL MUST WIN · PAYS ×${parlayOdds}`
              : multi
                ? `${picks.length} SINGLES · ${singlesTotal || 0} PINS`
                : 'SINGLE BET'
          }
          onClose={() => onOpenChange(false)}
          busy={placing}
          keyboardAvoiding
          bodyMaxHeight={420}
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
          {/* Singles / Parlay switch (only meaningful for 2+ picks) */}
          {multi && (
            <View style={styles.modeRow}>
              <ToggleGroup
                variant="bar"
                options={[{ key: 'singles', label: 'Singles' }, { key: 'parlay', label: 'Parlay' }]}
                value={mode}
                onChange={(m: SlipMode) => setMode(m)}
              />
            </View>
          )}

          {/* Staged picks */}
          <View style={styles.pickList}>
            {picks.map(p => {
              const isSingles = effectiveMode === 'singles'
              return (
                <View key={p.marketId} style={styles.pickRow}>
                  <View style={styles.pickMain}>
                    <Text style={styles.pickText} numberOfLines={2}>{pickLabel(p)}</Text>
                    {isSingles && (
                      <View style={styles.pickWager}>
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
                  <TouchableOpacity
                    onPress={() => onRemovePick(p.marketId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.pickRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>

          {/* Parlay: one combined stake */}
          {effectiveMode === 'parlay' && (
            <WagerField
              wager={parlayWager}
              onChangeWager={setParlayWager}
              balance={balance}
              odds={parlayOdds}
              boostPct={boost ? boostPct : undefined}
            />
          )}

          {/* Item toggles — only when the slip resolves to a single bet. */}
          {oneBet ? (
            <>
              <GoldenTicketToggle ticketCount={ticketCount} enabled={insure} onToggle={setInsure} disabled={placing} />
              {effectiveMode === 'parlay' && (
                <WinnersCrutchToggle crutchCount={crutchCount} enabled={crutch} onToggle={setCrutch} disabled={placing} />
              )}
              <EnergyDrinkToggle boostCount={boostCount} enabled={boost} onToggle={setBoost} disabled={placing} />
            </>
          ) : (
            (ticketCount > 0 || boostCount > 0) && (
              <Text style={styles.itemNote}>
                Place a pick on its own to attach a Golden Ticket or Energy Drink.
              </Text>
            )
          )}

          {!canPlace && effectiveMode === 'singles' && singlesTotal > balance && (
            <Text style={styles.warning}>Total stake exceeds your balance.</Text>
          )}
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

  modeRow: { marginBottom: 14 },

  pickList: { marginBottom: 4 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  pickMain: { flex: 1 },
  pickText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  pickWager: { marginTop: 2 },
  pickRemove: {
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
