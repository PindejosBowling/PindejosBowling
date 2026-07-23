import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing, type } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import TicketCard from './TicketCard'
import WagerField from './WagerField'
import TermsBlock from '../ui/TermsBlock'
import { TERMS } from '../../data/pinsinoExplainers'
import GoldenTicketToggle from '../auction/GoldenTicketToggle'
import WinnersCrutchToggle from '../auction/WinnersCrutchToggle'
import EnergyDrinkToggle from '../auction/EnergyDrinkToggle'
import { betLineSuffix } from '../../hooks/usePinsinoData'
import { fmtOdds } from '../../utils/bets'

// One individual pick staged in the slip — a chosen VALUE on a market (the
// line the bettor intends to beat, with its quoted price). Combines with
// other picks into a parlay, or places as its own single. Placement is
// line-shaped (place_bet_at_lines): selectionId is set only when the value
// sits on a posted rung (display/dedup convenience) — a custom value carries
// null and the server mints the rung at placement.
export interface SlipPick {
  selectionId: string | null
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

// One COMBO SPEC staged in the slip — a combo the bettor composed that does
// NOT have a market yet. The market is created at placement, atomically with
// the bet (compose_combo_bet), so an unbet combo market can never exist.
// Combos behave exactly like picks in the slip: they parlay with regular
// picks and with other combos, or place as their own single.
export interface SlipCombo {
  key: string          // canonical identity (stat|scope|game|members) — staging key
  weekId: string
  memberIds: string[]  // sorted
  memberNames: string[]
  stat: string
  scope: 'game' | 'night'
  gameNumber: number | null
  // The CHOSEN rung from the BuilderBar's previewed ladder. compose_combo_bet
  // takes `line` verbatim (it must match a posted/mintable rung) and the leg
  // snapshots the rung's odds; `odds` here is the previewed price for display.
  line: number | null
  odds: number | null
}

type SlipMode = 'singles' | 'parlay'

// A normalized placement request: at most one parlay (the combined picks +
// combo specs) plus a list of standalone single bets (singles-mode picks and
// combos, and/or every special). Regular picks are referenced by MARKET id —
// the provider resolves them to line-shaped {market_id, line, quoted_odds}
// legs (place_bet_at_lines / compose extra_picks); specials keep resolved
// selection ids (bets.place). Items attach to the sole bet only.
export interface SlipSubmit {
  parlay: { pickMarketIds: string[]; comboKeys: string[]; stake: number } | null
  singles: { pickMarketIds?: string[]; selectionIds?: string[]; comboKey?: string; lineId?: string; stake: number }[]
  insure: boolean
  crutch: boolean
  boost: boolean
}

interface BetSlipProps {
  picks: SlipPick[]
  specials: SlipSpecial[]
  combos: SlipCombo[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemovePick: (marketId: string) => void
  onRemoveSpecial: (key: string) => void
  onRemoveCombo: (key: string) => void
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

// Scope tag mirrors betLegSummary's convention (placed-bet rows): G<n> for a
// game leg, NIGHT for a whole-week leg (moneylines are game-implicit).
function scopeTag(marketType: string, gameNumber: number | null): string {
  if (gameNumber != null) return ` · G${gameNumber}`
  return marketType === 'moneyline' ? '' : ' · THIS WEEK'
}

function pickLabel(p: SlipPick): string {
  return (
    `${p.subjectName} · ${p.selectionLabel.toUpperCase()}` +
    betLineSuffix(p.marketType, p.line, p.statKey) +
    scopeTag(p.marketType, p.gameNumber)
  )
}

function comboLabel(c: SlipCombo): string {
  return (
    `${c.memberNames.join(' + ')} · OVER` +
    betLineSuffix('combo', c.line, c.stat) +
    scopeTag('combo', c.gameNumber)
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
  combos,
  open,
  onOpenChange,
  onRemovePick,
  onRemoveSpecial,
  onRemoveCombo,
  onClear,
  balance,
  placing,
  ticketCount,
  crutchCount,
  boostCount,
  boostPct,
  onPlace,
}: BetSlipProps) {
  const count = picks.length + specials.length + combos.length
  // Combos are pick-shaped for slip math: they parlay with picks and each other.
  const pickUnits = picks.length + combos.length
  const multiPicks = pickUnits > 1
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
      setMode(pickUnits > 1 ? 'parlay' : 'singles')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Picks + combos parlay only when there are 2+ units and parlay is chosen;
  // specials always stand alone. The resulting bet count drives item eligibility.
  const parlayPicks = multiPicks && mode === 'parlay'
  const pickBets = parlayPicks ? 1 : pickUnits
  const totalBets = pickBets + specials.length

  // Items attach to exactly ONE bet, so they're offered only when the slip
  // resolves to a single bet. A crutch additionally needs that bet to be
  // multi-leg (a parlay of picks/combos, or a multi-leg special).
  const oneBet = totalBets === 1
  const oneBetMultiLeg =
    oneBet &&
    ((parlayPicks && specials.length === 0 && pickUnits >= 2) ||
      (specials.length === 1 && pickUnits === 0 && specials[0].multiLeg))

  // Engine-priced legs: the parlay pays the product of each leg's actual odds
  // (pre-engine this degenerated to 2^n).
  const parlayOdds = useMemo(
    () =>
      picks.reduce((prod, p) => prod * (p.odds || 2), 1) *
      combos.reduce((prod, c) => prod * (c.odds ?? 2), 1),
    [picks, combos]
  )

  const specialsTotal = specials.reduce((s, sp) => s + (parseInt(specialWagers[sp.key] ?? '', 10) || 0), 0)
  const singlesPickTotal =
    picks.reduce((s, p) => s + (parseInt(singleWagers[p.marketId] ?? '', 10) || 0), 0) +
    combos.reduce((s, c) => s + (parseInt(singleWagers[c.key] ?? '', 10) || 0), 0)
  const parlayNum = parseInt(parlayWager, 10)
  const grandTotal = specialsTotal + (parlayPicks ? (parlayNum || 0) : singlesPickTotal)

  const specialsValid = specials.every(sp => {
    const n = parseInt(specialWagers[sp.key] ?? '', 10)
    return !isNaN(n) && n >= 10
  })
  const picksValid = parlayPicks
    ? !isNaN(parlayNum) && parlayNum >= 10
    : [...picks.map(p => p.marketId), ...combos.map(c => c.key)].every(k => {
        const n = parseInt(singleWagers[k] ?? '', 10)
        return !isNaN(n) && n >= 10
      })
  const canPlace = count > 0 && specialsValid && picksValid && grandTotal <= balance

  function submit() {
    if (!canPlace) return
    const singles: SlipSubmit['singles'] = []
    if (!parlayPicks) {
      for (const p of picks) singles.push({ pickMarketIds: [p.marketId], stake: parseInt(singleWagers[p.marketId], 10) })
      for (const c of combos) singles.push({ comboKey: c.key, stake: parseInt(singleWagers[c.key], 10) })
    }
    for (const sp of specials) singles.push({ selectionIds: sp.selectionIds, lineId: sp.lineId, stake: parseInt(specialWagers[sp.key], 10) })
    onPlace({
      parlay: parlayPicks
        ? { pickMarketIds: picks.map(p => p.marketId), comboKeys: combos.map(c => c.key), stake: parlayNum }
        : null,
      singles,
      insure: oneBet && insure,
      crutch: oneBetMultiLeg && crutch,
      boost: oneBet && boost,
    })
  }

  const ctaLabel = totalBets > 1 ? `Place ${totalBets} Bets` : 'Place Bet'
  const subtitle = `${totalBets} ${totalBets === 1 ? 'BET' : 'BETS'} · ${grandTotal || 0} PINS`

  // Items attach to the sole resulting bet — and when oneBet holds, exactly ONE
  // ticket card renders, so every ticket footer can carry the toggles gated on
  // oneBet without double-rendering.
  const itemToggles = oneBet ? (
    <View style={styles.itemToggles}>
      <GoldenTicketToggle ticketCount={ticketCount} enabled={insure} onToggle={setInsure} disabled={placing} />
      {oneBetMultiLeg && (
        <WinnersCrutchToggle crutchCount={crutchCount} enabled={crutch} onToggle={setCrutch} disabled={placing} />
      )}
      <EnergyDrinkToggle boostCount={boostCount} enabled={boost} onToggle={setBoost} disabled={placing} />
    </View>
  ) : null

  // One leg line inside a ticket: label text + its ✕ remove.
  const legLine = (key: string, text: string, onRemove: () => void, tag?: string) => (
    <View key={key} style={styles.legRow}>
      <View style={styles.legMain}>
        {tag != null && <Text style={styles.comboTag}>{tag}</Text>}
        <Text style={styles.legText} numberOfLines={2}>{text}</Text>
      </View>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.remove}>✕</Text>
      </TouchableOpacity>
    </View>
  )

  // The condition part of a pick, sans subject (the ticket header carries it).
  const pickCondition = (p: SlipPick) =>
    p.selectionLabel.toUpperCase() +
    betLineSuffix(p.marketType, p.line, p.statKey) +
    scopeTag(p.marketType, p.gameNumber)

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
              ...combos.map(c => `COMBO ${c.memberNames.join('+')}`),
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
          {/* Mode toggle — merging/splitting the pick tickets below. */}
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

          {/* ── One ticket card per resulting bet ── */}
          {pickUnits > 0 && parlayPicks && (
            <TicketCard
              header={{
                title: `${pickUnits}-LEG PARLAY`,
                badge: { label: fmtOdds(parlayOdds), color: colors.accent },
              }}
              footer={
                <>
                  <WagerField
                    wager={parlayWager}
                    onChangeWager={setParlayWager}
                    balance={balance}
                    odds={parlayOdds}
                    boostPct={oneBet && boost ? boostPct : undefined}
                  />
                  {itemToggles}
                </>
              }
            >
              <Text style={styles.allMustWin}>ALL LEGS MUST WIN</Text>
              {combos.map(c => legLine(c.key, comboLabel(c), () => onRemoveCombo(c.key), 'COMBO'))}
              {picks.map(p => legLine(p.marketId, pickLabel(p), () => onRemovePick(p.marketId)))}
            </TicketCard>
          )}
          {pickUnits > 0 && !parlayPicks && (
            <>
              {combos.map(c => (
                <TicketCard
                  key={c.key}
                  header={{ title: 'COMBO', badge: { label: fmtOdds(c.odds ?? 2), color: colors.accent } }}
                  footer={
                    <>
                      <WagerField
                        wager={singleWagers[c.key] ?? ''}
                        onChangeWager={v => setSingleWagers(s => ({ ...s, [c.key]: v }))}
                        balance={balance}
                        odds={c.odds ?? 2}
                        boostPct={oneBet && boost ? boostPct : undefined}
                        label="STAKE (pins)"
                        compact
                      />
                      {itemToggles}
                    </>
                  }
                >
                  {legLine(c.key, comboLabel(c), () => onRemoveCombo(c.key))}
                </TicketCard>
              ))}
              {picks.map(p => (
                <TicketCard
                  key={p.marketId}
                  header={{ title: p.subjectName, badge: { label: fmtOdds(p.odds), color: colors.accent } }}
                  footer={
                    <>
                      <WagerField
                        wager={singleWagers[p.marketId] ?? ''}
                        onChangeWager={v => setSingleWagers(s => ({ ...s, [p.marketId]: v }))}
                        balance={balance}
                        odds={p.odds}
                        boostPct={oneBet && boost ? boostPct : undefined}
                        label="STAKE (pins)"
                        compact
                      />
                      {itemToggles}
                    </>
                  }
                >
                  {legLine(p.marketId, pickCondition(p), () => onRemovePick(p.marketId))}
                </TicketCard>
              ))}
            </>
          )}

          {/* Specials — always their own (gold-trimmed) tickets. */}
          {specials.map(sp => (
            <TicketCard
              key={sp.key}
              gold={sp.category === 'special'}
              header={{
                title: sp.title,
                titleGold: sp.category === 'special',
                badge: {
                  label: fmtOdds(sp.combinedOdds),
                  color: sp.category === 'special' ? colors.gold : colors.accent,
                },
              }}
              footer={
                <>
                  <WagerField
                    wager={specialWagers[sp.key] ?? ''}
                    onChangeWager={v => setSpecialWagers(s => ({ ...s, [sp.key]: v }))}
                    balance={balance}
                    odds={sp.combinedOdds}
                    boostPct={oneBet && boost ? boostPct : undefined}
                    label="STAKE (pins)"
                    compact
                  />
                  {itemToggles}
                </>
              }
            >
              {legLine(sp.key, sp.summary, () => onRemoveSpecial(sp.key))}
            </TicketCard>
          ))}

          {/* Item availability note — items need a lone bet to attach to. */}
          {!oneBet && (ticketCount > 0 || boostCount > 0) && (
            <Text style={styles.itemNote}>
              Place a bet on its own to attach a Golden Ticket or Energy Drink.
            </Text>
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

  modeRow: { marginBottom: 12 },

  // A ticket's leg line: label + its ✕ remove.
  legRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: spacing.xs,
  },
  legMain: { flex: 1 },
  legText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  comboTag: {
    ...type.label,
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 10,
    color: colors.accent,
    marginBottom: 1,
  },
  allMustWin: {
    ...type.label,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  itemToggles: { marginTop: spacing.xs },
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
