import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing, type } from '../../theme'
import { deltaDir } from '../../utils/bets'

// One row of odds_engine_player_projection, camel-cased by the screen's fetch.
export interface ProjectionRow {
  stat: string // 'score' | 'clean_frames' | 'strikes' | 'spares'
  projected: number | null
  seasonAvg: number | null
  avgSource: string | null // 'season' | 'lifetime' | 'league' | null
}

interface BookProjectionCardProps {
  rows: ProjectionRow[]
  // Scope scaling: the RPC returns PER-GAME values; Weekly scope shows the
  // night expectation (× the scheduled game count), Game N shows per game.
  nGames: number
}

// Column heads — the full STAT_LABELS forms, matching the pill labels below
// (they wrap to two lines within each column when needed). `total_pins` is the
// combo vocabulary's spelling of the score column (group rows sum member
// pinfall, not a posted score line).
const COLUMN_LABELS: Record<string, string> = {
  score: 'TOTAL PINS',
  total_pins: 'TOTAL PINS',
  clean_frames: 'CLEAN FRAMES',
  strikes: 'STRIKES',
  spares: 'SPARES',
}

// The board's averages-vs-book strip: what the player actually averages (the
// headline) with the book's expectation beneath for comparison — a ▲ rides
// the AVERAGE when it sits above what the book projects (celebration-only;
// an average under forecast gets no mark at all). Pure display — the
// engine's variance/quote band stays server-side, and no staging/pricing
// flows through here. One presentation for both board modes — combo mode
// feeds the group's summed rows through the same card, no framing overrides.
// Headerless: the card's title lives in the board header above it (which
// also hosts the scope picker), so the card is just the stats table.
export default function BookProjectionCard({ rows, nGames }: BookProjectionCardProps) {
  const shown = rows.filter(r => r.projected != null)
  // Engine off (or no rows yet): no book side to compare against.
  if (shown.length === 0) return null

  const fallback = shown.some(r => r.seasonAvg != null && r.avgSource !== 'season')

  // Precompute each stat's scope-scaled cell so the two value rows (average /
  // forecast) can be laid out as an aligned grid beside their left labels.
  const cells = shown.map(r => {
    const projected = r.projected! * nGames
    const avg = r.seasonAvg != null ? r.seasonAvg * nGames : null
    // The AVERAGE's position vs the book (shared dead band = "on form").
    return { stat: r.stat, label: COLUMN_LABELS[r.stat] ?? r.stat.toUpperCase(), projected, avg, dir: deltaDir(avg, projected), avgSource: r.avgSource }
  })

  return (
    <View style={styles.card}>
      {/* Stat headers across the full width — each sized to one row (they
          auto-shrink rather than wrap). */}
      <View style={styles.valuesRow}>
        {cells.map(c => (
          <Text
            key={c.stat}
            style={styles.statLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {c.label}
          </Text>
        ))}
      </View>

      {/* Season averages (accent) across the full width. */}
      <View style={[styles.valuesRow, styles.valueRowGap]}>
        {cells.map(c => (
          <View key={c.stat} style={styles.cell}>
            <View style={styles.avgRow}>
              <Text style={[styles.avgValue, c.avg == null && styles.avgNone]}>
                {c.avg == null ? '—' : `${c.avg.toFixed(1)}${c.avgSource !== 'season' ? '*' : ''}`}
              </Text>
              {/* Celebration-only: the ▲ marks an average running ahead of the
                  book, floating inline just after the value. No ▼: an average
                  under forecast just shows the numbers, never a red mark
                  (nobody gets shamed here). */}
              {c.dir === 'up' && <Text style={[styles.delta, styles.deltaUp]}>▲</Text>}
            </View>
          </View>
        ))}
      </View>

      {/* The book's projections (grey), sized to match the averages above. */}
      <View style={[styles.valuesRow, styles.valueRowGap]}>
        {cells.map(c => (
          <View key={c.stat} style={styles.cell}>
            <Text style={styles.book}>{c.projected.toFixed(1)}</Text>
          </View>
        ))}
      </View>

      {fallback && (
        <Text style={styles.footnote}>* no season games yet — lifetime/league average shown</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Same tinted-card language as LineRow — the strip sits between the player
  // select and the subject's line card.
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surfaceTint,
    marginBottom: spacing.sm,
  },
  // A full-width row of equal columns — no left gutter, so the values (and
  // headers) use the whole card width. gap opens space between columns.
  valuesRow: { flexDirection: 'row', gap: 14 },
  // Vertical breathing room between the header and the two value rows (the
  // AVERAGE/FORECAST labels that used to provide it are gone; colour alone
  // distinguishes the accent averages from the grey projections).
  valueRowGap: { marginTop: 8 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statLabel: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.text,
    textAlign: 'center',
  },
  // The player's AVERAGE gets the big accent treatment (the memberSoloValue
  // idiom) — it's the headline; the book reads as the comparison beneath.
  avgValue: {
    ...type.value,
    color: colors.accent,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  avgNone: { color: colors.muted2 },
  // Value + inline ▲, centered as a group within the cell.
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // The projection reads at the SAME size as the average — grey vs the accent
  // average is the only distinction now that the row labels are gone.
  book: {
    ...type.value,
    letterSpacing: 0.5,
    color: colors.muted,
    textAlign: 'center',
  },
  delta: { fontFamily: fonts.barlowCondensed, fontSize: 10 },
  deltaUp: { color: colors.success },
  footnote: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    fontStyle: 'italic',
    color: colors.muted2,
    marginTop: 8,
    textAlign: 'center',
  },
})
