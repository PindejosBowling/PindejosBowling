import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '../../theme'

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
  scopeLabel: string
}

// Column heads — compressed forms of the shared STAT_LABELS (four columns
// have to share a phone width).
const COLUMN_LABELS: Record<string, string> = {
  score: 'PINS',
  clean_frames: 'CLEAN',
  strikes: 'STRIKES',
  spares: 'SPARES',
}

// The board's projection strip: what the book expects from the selected player
// this week (the OddsEngine mean) over what they actually average. Pure
// display — the engine's variance/quote band stays server-side, and no
// staging/pricing flows through here.
export default function BookProjectionCard({ rows, nGames, scopeLabel }: BookProjectionCardProps) {
  const shown = rows.filter(r => r.projected != null)
  // Engine off (or no rows yet): the book has no opinion to show.
  if (shown.length === 0) return null

  const fallback = shown.some(r => r.seasonAvg != null && r.avgSource !== 'season')

  return (
    <View style={styles.card}>
      <Text style={styles.header}>BOOK PROJECTION · {scopeLabel}</Text>
      <View style={styles.columns}>
        {shown.map(r => {
          const projected = r.projected! * nGames
          const avg = r.seasonAvg != null ? r.seasonAvg * nGames : null
          // Direction vs the player's own average — is the book calling for a
          // hot or cold week? Sub-tenth deltas read as "on form".
          const delta = avg != null ? projected - avg : null
          const dir = delta == null || Math.abs(delta) < 0.05 ? null : delta > 0 ? 'up' : 'down'
          return (
            <View key={r.stat} style={styles.column}>
              <Text style={styles.statLabel}>{COLUMN_LABELS[r.stat] ?? r.stat.toUpperCase()}</Text>
              <View style={styles.projectedRow}>
                <Text style={styles.projected}>{projected.toFixed(1)}</Text>
                {dir != null && (
                  <Text style={[styles.delta, dir === 'up' ? styles.deltaUp : styles.deltaDown]}>
                    {dir === 'up' ? '▲' : '▼'}
                  </Text>
                )}
              </View>
              <Text style={styles.avg}>
                {avg == null ? 'NO AVG' : `AVG ${avg.toFixed(1)}${r.avgSource !== 'season' ? '*' : ''}`}
              </Text>
            </View>
          )
        })}
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
  header: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    textAlign: 'center',
  },
  columns: {
    flexDirection: 'row',
    marginTop: 8,
  },
  column: { flex: 1, alignItems: 'center' },
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted2,
  },
  projectedRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  // The book's number gets the big accent treatment (the memberSoloValue
  // idiom) — it's the headline of the strip.
  projected: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 20,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  delta: { fontFamily: fonts.barlowCondensed, fontSize: 10 },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
  avg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 2,
  },
  footnote: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    fontStyle: 'italic',
    color: colors.muted2,
    marginTop: 8,
    textAlign: 'center',
  },
})
