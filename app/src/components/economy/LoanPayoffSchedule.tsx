import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import type { LoanSchedule } from '../../utils/loanSchedule'
import { MAX_SIMULATED_WEEKS } from '../../utils/loanSchedule'
import { GAMES_PER_WEEK } from '../../utils/helpers'
import { formatPins } from '../../utils/formatting'

interface LoanPayoffScheduleProps {
  // Simulated via simulateLoanPayoff — callers compute it in useMemo.
  schedule: LoanSchedule
  startingDebt: number
  // The projection inputs, echoed in the headline so the numbers explain themselves.
  avgPerGame: number
  // True when the player has no bowled games and the league average was used.
  usingLeagueAvg?: boolean
  // Hide the internal "PROJECTED PAYOFF" label when the caller already renders
  // one (e.g. the active-loan card's collapsible toggle).
  showTitle?: boolean
}

// The personalized payoff diagram: a status headline over week-by-week rows
// (shark's cut / interest added / still owed) with a shrinking debt bar.
// Presentational only — all math lives in utils/loanSchedule.ts.
export default function LoanPayoffSchedule({
  schedule,
  startingDebt,
  avgPerGame,
  usingLeagueAvg,
  showTitle = true,
}: LoanPayoffScheduleProps) {
  const { weeks, status, weeksToPayoff, totalInterest } = schedule

  const avgLabel = usingLeagueAvg
    ? `league average (~${Math.round(avgPerGame)}/game)`
    : `your average (~${Math.round(avgPerGame)}/game)`
  const basis = `${avgLabel} × ${GAMES_PER_WEEK} games a week`

  // The weekly pinfall the shark's cut is taken from — the projection input,
  // constant across weeks (matches simulateLoanPayoff's weeklyPincome).
  const weeklyPincome = Math.round(avgPerGame) * GAMES_PER_WEEK

  let headline: string
  let headlineDanger = false
  switch (status) {
    case 'paid_off':
      headline = `At ${avgLabel}, paid off in ~${weeksToPayoff} week${weeksToPayoff === 1 ? '' : 's'} · ${formatPins(totalInterest)} pins total interest`
      break
    case 'truncated':
      headline = `At ${avgLabel}, still owing ${formatPins(weeks[weeks.length - 1].debtAfter)} after ${MAX_SIMULATED_WEEKS} weeks — this one takes a while`
      break
    case 'spiral':
      headline = `At ${avgLabel}, the weekly cut never outruns the interest — this debt does not shrink. The shark wins.`
      headlineDanger = true
      break
    case 'no_data':
      headline = 'No games on record yet — no payoff projection available.'
      break
  }

  return (
    <View style={styles.wrap}>
      {showTitle && <Text style={styles.title}>PROJECTED PAYOFF</Text>}
      <Text style={[styles.headline, headlineDanger && styles.headlineDanger]}>{headline}</Text>
      {status !== 'no_data' && weeks.length > 0 && (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.colLabel, styles.colWeek]}>WK</Text>
            <Text style={[styles.colLabel, styles.colPincome]}>PINCOME</Text>
            <Text style={[styles.colLabel, styles.colTakes]}>SHARK</Text>
            <Text style={[styles.colLabel, styles.colInterest]}>INTEREST</Text>
            <Text style={[styles.colLabel, styles.colOwe]}>STILL OWED</Text>
          </View>
          {weeks.map(w => {
            const paidOff = w.debtAfter <= 0
            // Bar shrinks with the debt; spiral bars clamp at full width.
            const pct = Math.max(0, Math.min(100, (w.debtAfter / startingDebt) * 100))
            return (
              <View key={w.week} style={styles.row}>
                <Text style={[styles.cell, styles.colWeek]}>{w.week}</Text>
                <Text style={[styles.cell, styles.colPincome, styles.cellPincome]}>
                  {formatPins(weeklyPincome)}
                </Text>
                <Text style={[styles.cell, styles.colTakes, styles.cellGarnish]}>
                  −{formatPins(w.garnished)}
                </Text>
                <Text style={[styles.cell, styles.colInterest, w.interest > 0 && styles.cellInterest]}>
                  {w.interest > 0 ? `+${formatPins(w.interest)}` : '—'}
                </Text>
                <View style={styles.colOwe}>
                  {paidOff ? (
                    <Text style={[styles.cell, styles.cellPaidOff]}>PAID OFF</Text>
                  ) : (
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                      <Text style={styles.barLabel}>{formatPins(w.debtAfter)}</Text>
                    </View>
                  )}
                </View>
              </View>
            )
          })}
          <Text style={styles.basis}>Projected from {basis}. Real weeks use your actual scores.</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  headline: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 10,
  },
  headlineDanger: { color: colors.danger },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  colLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted2,
  },
  colWeek: { width: 20, textAlign: 'center' },
  // Left-aligned, each just wide enough for its header/number, to hand the
  // freed horizontal space to the STILL OWED bar.
  colPincome: { width: 46, textAlign: 'center' },
  colTakes: { width: 42, textAlign: 'center' },
  colInterest: { width: 50, textAlign: 'center' },
  colOwe: { flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  cell: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
  },
  cellPincome: { color: colors.muted },
  cellGarnish: { color: colors.success },
  cellInterest: { color: colors.danger },
  cellPaidOff: { color: colors.success, letterSpacing: 1 },

  barTrack: {
    height: 16,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  barFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.dangerDim,
    borderRadius: radius.cardSm,
  },
  barLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    paddingLeft: 8,
  },

  basis: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted2,
    lineHeight: 15,
    marginTop: 8,
  },
})
