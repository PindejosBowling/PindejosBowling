import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import CenterModal from '../ui/CenterModal'
import { betLineSuffix, type BetView } from '../../hooks/usePinsinoData'
import { resultBadge, betPayout, betReturn, betReturnDisplay } from '../../utils/bets'
import { haunts } from '../../utils/supabase/db'
import { useBetSlip } from './BetSlipProvider'

interface BetDetailModalProps {
  bet: BetView | null
  onClose: () => void
  // Ghost in the Slip affordance (only wired from the Sportsbook board, which
  // shows every player's pending bets). When canHaunt is true the "haunt this
  // bet" CTA renders; pressing it asks the parent to open the confirm sheet at
  // screen level (avoids nesting a BottomSheet inside this RN Modal).
  canHaunt?: boolean
  alreadyHaunted?: boolean
  onRequestHaunt?: () => void
}

// Shared "Bet Details" overlay — the canonical breakdown of a single bet, opened
// from BetRow (Active/Settled Bets) and from LedgerRow (ledger activity).
export default function BetDetailModal({ bet, onClose, canHaunt, alreadyHaunted, onRequestHaunt }: BetDetailModalProps) {
  // Reveal: once a bet has WON, RLS exposes any Ghost in the Slip haunts on it.
  // (Hooks run unconditionally — the early null-return lives below them.)
  const { enabled: copyEnabled, copyBet } = useBetSlip()
  const [haunters, setHaunters] = useState<{ name: string; cut: number | null }[]>([])
  useEffect(() => {
    let active = true
    if (bet && bet.status === 'won') {
      haunts.listForBet(bet.id).then(({ data }) => {
        if (!active) return
        setHaunters((data ?? []).map((r: any) => ({ name: r.players?.name ?? '—', cut: r.payout_amount })))
      })
    } else {
      setHaunters([])
    }
    return () => { active = false }
  }, [bet?.id, bet?.status])

  if (!bet) return null

  // Attachable items spent on this bet at placement (win or lose), each surfaced
  // below regardless of whether it has fired yet — attached while pending, its
  // outcome once settled. A Winner's Crutch "fired" iff a leg was cancelled
  // ('crutched'): the reason a missed parlay still paid (or pushed).
  const insured = bet.insuranceItemId != null
  const hasCrutch = bet.crutchItemId != null
  const boosted = bet.boostItemId != null
  const crutchSaved = bet.legs.some(leg => leg.result === 'crutched')

  // Action buttons pin below the scrolling body (CenterModal footer).
  const footer = (
    <>
      {/* Copy this bet — any active (pending) bet can be re-placed for
          yourself, straights/parlays and Specials alike. Closes this modal
          and raises the bet slip (owned by the app-level BetSlipProvider)
          with the same selection(s) re-resolved against the current live
          line; stake starts blank. */}
      {copyEnabled && bet.status === 'pending' && (
        <TouchableOpacity
          style={styles.copyBtn}
          onPress={() => { onClose(); copyBet(bet) }}
        >
          <Text style={styles.copyBtnText}>📋 Place this bet</Text>
        </TouchableOpacity>
      )}

      {/* Ghost in the Slip CTA — only on someone else's pending bet when the
          viewer holds a Ghost and hasn't haunted it yet. The confirm sheet is
          opened by the parent at screen level (no nested modals). */}
      {canHaunt && (
        <TouchableOpacity style={styles.hauntBtn} onPress={onRequestHaunt}>
          <Text style={styles.hauntBtnText}>👻 Haunt this bet</Text>
        </TouchableOpacity>
      )}
      {alreadyHaunted && bet.status === 'pending' && (
        <Text style={[styles.customDescription, styles.hauntingNote]}>
          👻 You're haunting this bet
        </Text>
      )}
    </>
  )

  return (
    <CenterModal title="Bet Details" onClose={onClose} footer={footer}>
          <View style={styles.row}>
            <Text style={styles.label}>BETTOR</Text>
            <Text style={styles.value}>{bet.bettorName}</Text>
          </View>

          {/* Custom-line branding (snapshotted onto the bet at placement). */}
          {bet.customLineTitle != null && (
            <View style={styles.row}>
              <Text style={styles.label}>SPECIAL</Text>
              <Text style={[styles.value, bet.customLineCategory === 'special' && { color: colors.gold }]}>
                {bet.customLineTitle}
              </Text>
              {!!bet.customLineDescription && (
                <Text style={styles.customDescription}>{bet.customLineDescription}</Text>
              )}
            </View>
          )}

          {bet.seasonNumber != null && (
            <View style={styles.row}>
              <Text style={styles.label}>SEASON</Text>
              <Text style={styles.value}>{bet.seasonNumber}</Text>
            </View>
          )}

          {bet.weekNumber != null && (
            <View style={styles.row}>
              <Text style={styles.label}>WEEK</Text>
              <Text style={styles.value}>{bet.weekNumber}</Text>
            </View>
          )}

          {/* Legs, consolidated — a single bet is just one leg. Each line carries
              its own subject, pick, line, and game. Once settled, the leg's actual
              score follows a divider, color-coded to the leg's win/loss outcome. */}
          <View style={styles.row}>
            <Text style={styles.label}>{bet.legCount > 1 ? `LEGS (${bet.legCount})` : 'SELECTION'}</Text>
            {bet.legs.map((leg, i) => (
              <Text key={i} style={[styles.value, { marginTop: i === 0 ? 0 : 4 }]}>
                {leg.subjectName} · {leg.pick?.toUpperCase()}
                {betLineSuffix(leg.marketType, leg.line, leg.statKey)}
                {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
                {leg.actualScore != null && (
                  <>
                    {' -- '}
                    <Text style={{ color: resultBadge(leg.result ?? '')?.color ?? colors.muted }}>
                      {leg.actualScore}
                    </Text>
                  </>
                )}
                {/* A crutched leg lost on the scoreboard but was cancelled — call it
                    out so the leg's muted score doesn't read as a normal result. */}
                {leg.result === 'crutched' && (
                  <Text style={{ color: colors.gold }}> · {resultBadge('crutched')?.label}</Text>
                )}
              </Text>
            ))}
          </View>

          {/* Ghost in the Slip reveal: once won, who slipped in and took the profit. */}
          {haunters.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>HAUNTED 👻</Text>
              <Text style={[styles.value, { color: colors.gold }]}>
                {haunters.length === 1 ? 'A ghost stole the profit' : `${haunters.length} ghosts split the profit`}
              </Text>
              {haunters.map((h, i) => (
                <Text key={i} style={styles.customDescription}>
                  {h.name} — {h.cut ?? 0} pins
                </Text>
              ))}
              <Text style={styles.customDescription}>The bettor kept only their stake.</Text>
            </View>
          )}

          {/* Attached items (Golden Ticket / Winner's Crutch / Energy Drink),
              spent at placement. Each shows "Attached" while the bet is pending
              and its realized outcome once settled. */}
          {insured && (
            <View style={styles.row}>
              <Text style={styles.label}>GOLDEN TICKET 🎟️</Text>
              <Text style={[styles.value, { color: colors.gold }]}>
                {bet.status === 'lost' ? 'Stake refunded'
                  : bet.status === 'pending' ? 'Attached'
                    : bet.status === 'won' ? 'Not needed' : 'Spent'}
              </Text>
              <Text style={styles.customDescription}>
                {bet.status === 'lost'
                  ? 'Your Golden Ticket refunded your stake when the bet lost.'
                  : bet.status === 'pending'
                    ? 'Refunds your stake if this bet loses — spent at placement either way.'
                    : bet.status === 'won'
                      ? 'The bet won, so the Golden Ticket went unused (it only pays on a loss).'
                      : 'A Golden Ticket was attached; it only pays out on a loss.'}
              </Text>
            </View>
          )}

          {hasCrutch && (
            <View style={styles.row}>
              <Text style={styles.label}>WINNER'S CRUTCH 🩼</Text>
              <Text style={[styles.value, { color: colors.gold }]}>
                {crutchSaved
                  ? (bet.status === 'won' ? 'Salvaged this bet' : 'Cancelled the missed leg')
                  : bet.status === 'pending' ? 'Attached'
                    : bet.status === 'won' ? 'Not needed' : 'Spent'}
              </Text>
              <Text style={styles.customDescription}>
                {crutchSaved
                  ? `A leg missed but was cancelled by your Winner's Crutch${bet.status === 'won'
                      ? ' — the rest of the parlay cashed at reduced odds.'
                      : ' — with no surviving legs, your stake was refunded.'}`
                  : bet.status === 'pending'
                    ? 'Cancels a single losing leg if your parlay misses by exactly one.'
                    : bet.status === 'won'
                      ? 'Your parlay won outright, so the Crutch went unused (spent at placement).'
                      : 'A Winner’s Crutch was attached, but the parlay missed by more than one leg.'}
              </Text>
            </View>
          )}

          {boosted && (
            <View style={styles.row}>
              <Text style={styles.label}>ENERGY DRINK ⚡️</Text>
              <Text style={[styles.value, { color: colors.gold }]}>
                {bet.status === 'won' ? 'Profit doubled' : bet.status === 'pending' ? 'Attached' : 'Spent'}
              </Text>
              <Text style={styles.customDescription}>
                {bet.status === 'won'
                  ? 'An Energy Drink doubled your profit — the House paid a bonus on top of the payout (1:1 became 2:1).'
                  : bet.status === 'pending'
                    ? 'Doubles your profit if this bet wins — spent at placement either way.'
                    : 'An Energy Drink was attached but only pays on a win — it was spent at placement.'}
              </Text>
            </View>
          )}

          <View style={styles.row}>
            <Text style={styles.label}>WAGER</Text>
            <Text style={styles.value}>{bet.stake} pins</Text>
          </View>

          {/* PAYOUT is the static "to win" figure; RETURN is the realized flow
              once settled (Pending until then). Both are player-perspective. */}
          <View style={styles.row}>
            <Text style={styles.label}>PAYOUT</Text>
            <Text style={styles.value}>{betPayout(bet)} pins</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>STATUS</Text>
            <Text style={[styles.value, { color: resultBadge(bet.status)?.color || colors.muted }]}>
              {resultBadge(bet.status)?.label || 'PENDING'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>RETURN</Text>
            {betReturn(bet) == null ? (
              <Text style={[styles.value, { color: colors.muted }]}>PENDING</Text>
            ) : (
              <Text style={styles.value}>{betReturnDisplay(bet)} pins</Text>
            )}
          </View>
    </CenterModal>
  )
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
  },
  customDescription: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  copyBtn: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  copyBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.bg,
  },
  hauntBtn: {
    marginTop: 8,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: 12,
    alignItems: 'center',
  },
  hauntBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.gold,
  },
  hauntingNote: {
    textAlign: 'center',
    color: colors.gold,
    marginTop: 12,
  },
})
