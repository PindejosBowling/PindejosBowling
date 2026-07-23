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
import { bets } from '../../utils/supabase/db'

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

// Mirror of the server's correlation-cluster rule (place_house_bet →
// odds_engine_parlay_factors_internal): legs cluster when they share a
// subject player AND scopes overlap (same game, or either night-scoped —
// night contains every game; combo members count). Returns the LARGEST
// cluster size — 2 is repriced jointly (allowed), 3+ is rejected at
// placement, so the UI forces singles early. Server stays authoritative.
function maxCorrelatedCluster(picks: SlipPick[], combos: SlipCombo[]): number {
  const legs = [
    ...picks.map(p => ({ subjects: p.subjectPlayerId ? [p.subjectPlayerId] : [], game: p.gameNumber })),
    ...combos.map(c => ({ subjects: c.memberIds, game: c.gameNumber })),
  ]
  const parent = legs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let a = 0; a < legs.length; a++) {
    for (let b = a + 1; b < legs.length; b++) {
      const shared = legs[a].subjects.some(s => legs[b].subjects.includes(s))
      const overlap = legs[a].game == null || legs[b].game == null || legs[a].game === legs[b].game
      if (shared && overlap) parent[find(b)] = find(a)
    }
  }
  const sizes = new Map<number, number>()
  for (let i = 0; i < legs.length; i++) {
    const r = find(i)
    sizes.set(r, (sizes.get(r) ?? 0) + 1)
  }
  return Math.max(0, ...sizes.values())
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
      setMode(pickUnits > 1 && !parlayBlocked ? 'parlay' : 'singles')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // A 3+ leg correlated cluster can't be jointly priced — placement would
  // reject it, so the slip forces singles and says why.
  const parlayBlocked = useMemo(() => maxCorrelatedCluster(picks, combos) >= 3, [picks, combos])

  // Picks + combos parlay only when there are 2+ units and parlay is chosen;
  // specials always stand alone. The resulting bet count drives item eligibility.
  const parlayPicks = multiPicks && mode === 'parlay' && !parlayBlocked
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

  // Engine-priced legs: the naive product of each leg's odds — the instant
  // display fallback while the joint quote is in flight.
  const productOdds = useMemo(
    () =>
      picks.reduce((prod, p) => prod * (p.odds || 2), 1) *
      combos.reduce((prod, c) => prod * (c.odds ?? 2), 1),
    [picks, combos]
  )

  // The authoritative parlay price comes from parlay_price (correlated legs
  // are repriced off the joint model — the product overpays same-player
  // combinations). Keyed by the leg set so a stale quote never displays;
  // combos without a chosen line/odds yet can't preview (placement still
  // reprices). 300ms debounce, mirrors useLinePreview's posture.
  const parlayKey = JSON.stringify([
    picks.map(p => [p.marketId, p.line, p.odds]),
    combos.map(c => [c.key, c.line, c.odds]),
  ])
  const previewable =
    picks.every(p => p.line != null) &&
    combos.every(c => c.line != null && c.odds != null)
  const [jointQuote, setJointQuote] = useState<{
    key: string
    odds: number
    correlated: boolean
    // Per-leg correlation factors, aligned picks-then-combos (the RPC's leg
    // order) — effective leg odds = quoted × factor.
    factors: number[] | null
  } | null>(null)
  useEffect(() => {
    if (!open || !parlayPicks || !previewable) return
    let cancelled = false
    const key = parlayKey
    const t = setTimeout(async () => {
      const { data, error } = await bets.parlayPrice(
        combos[0]?.weekId ?? null,
        picks.map(p => ({ marketId: p.marketId, line: p.line as number, quotedOdds: p.odds })),
        combos.map(c => ({
          memberIds: c.memberIds, stat: c.stat, scope: c.scope,
          gameNumber: c.gameNumber, line: c.line as number, quotedOdds: c.odds as number,
        })),
      )
      if (cancelled || error || data == null || typeof data !== 'object') return
      const q = data as Record<string, unknown>
      if (q.odds != null) {
        setJointQuote({
          key,
          odds: Number(q.odds),
          correlated: !!q.correlated,
          factors: Array.isArray(q.factors) ? (q.factors as unknown[]).map(Number) : null,
        })
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [parlayKey, open, parlayPicks, previewable]) // eslint-disable-line react-hooks/exhaustive-deps

  const jointCurrent = jointQuote != null && jointQuote.key === parlayKey ? jointQuote : null
  const parlayOdds = jointCurrent?.odds ?? productOdds

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

  // One leg line inside a ticket: label text + optional contributing odds
  // (the parlay ticket shows each leg's effective multiple so the total
  // visibly equals their product) + its ✕ remove.
  const legLine = (key: string, text: string, onRemove: () => void, tag?: string, odds?: number | null) => (
    <View key={key} style={styles.legRow}>
      <View style={styles.legMain}>
        {tag != null && <Text style={styles.comboTag}>{tag}</Text>}
        <Text style={styles.legText} numberOfLines={2}>{text}</Text>
      </View>
      {odds != null && <Text style={styles.legOdds}>{fmtOdds(odds)}</Text>}
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.remove}>✕</Text>
      </TouchableOpacity>
    </View>
  )

  // Contributing odds per parlay leg: the staged quote × its correlation
  // factor once the joint quote lands (factors align picks-then-combos — the
  // RPC's leg order). Product of what's shown ≈ the ticket badge.
  const pickLegOdds = (i: number) =>
    picks[i].odds * (jointCurrent?.factors?.[i] ?? 1)
  const comboLegOdds = (j: number) =>
    (combos[j].odds ?? 2) * (jointCurrent?.factors?.[picks.length + j] ?? 1)

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
          {/* Mode toggle — merging/splitting the pick tickets below. A 3+ leg
              correlated cluster can't parlay (placement rejects it), so the
              toggle hides and the tickets stay singles with an explanation. */}
          {multiPicks && !parlayBlocked && (
            <View style={styles.modeRow}>
              <ToggleGroup
                variant="bar"
                options={[{ key: 'singles', label: 'Singles' }, { key: 'parlay', label: 'Parlay' }]}
                value={mode}
                onChange={(m: SlipMode) => setMode(m)}
              />
            </View>
          )}
          {multiPicks && parlayBlocked && (
            <Text style={styles.itemNote}>
              Too many correlated legs on one player to parlay — these place as
              singles. Two legs on the same player can still combine (priced
              jointly).
            </Text>
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
              {jointCurrent?.correlated && (
                <Text style={styles.correlatedNote}>
                  These legs are correlated, which impacts the payout
                </Text>
              )}
              {combos.map((c, j) => legLine(c.key, comboLabel(c), () => onRemoveCombo(c.key), 'COMBO', comboLegOdds(j)))}
              {picks.map((p, i) => legLine(p.marketId, pickLabel(p), () => onRemovePick(p.marketId), undefined, pickLegOdds(i)))}
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
  legOdds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 13,
    color: colors.accent,
    marginRight: 10,
    marginTop: 1,
  },
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
  correlatedNote: {
    ...type.label,
    color: colors.gold,
    marginTop: -6,
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
