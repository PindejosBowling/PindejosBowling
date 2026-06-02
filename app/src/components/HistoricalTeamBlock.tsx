import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import { initials } from '../utils/helpers'

interface Player {
  name: string
  score?: number | string
  present: boolean
}

interface Props {
  team: string
  players: Player[]
  total: number
  winner: boolean
}

export default function HistoricalTeamBlock({ team, players, total, winner }: Props) {
  return (
    <View style={styles.block}>
      <Text style={[styles.teamLabel, winner && styles.teamLabelWinner]}>{team}</Text>

      {players.map((p) => (
        <View key={p.name} style={[styles.playerRow, !p.present && styles.playerRowAbsent]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(p.name)}</Text>
          </View>
          <Text style={[styles.playerName, !p.present && styles.playerNameAbsent]} numberOfLines={1}>
            {p.name}{!p.present ? ' ' : ''}
            {!p.present ? <Text style={styles.absentTag}>OUT</Text> : null}
          </Text>
          <View style={styles.scoreGroup}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={[styles.scoreVal, !p.score && styles.scoreMuted]}>
              {p.score || '—'}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Team total</Text>
        <Text style={[styles.totalVal, winner ? styles.totalWinner : styles.totalLoser]}>{total}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 12,
  },
  teamLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  teamLabelWinner: { color: colors.accent },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  playerRowAbsent: { opacity: 0.5 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted },
  playerName: { flex: 1, fontFamily: fonts.barlow, fontSize: 14, color: colors.text },
  playerNameAbsent: { color: colors.muted },
  absentTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.danger,
    letterSpacing: 0.5,
  },

  scoreGroup: { alignItems: 'flex-end' },
  scoreLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 9,
    color: colors.muted2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scoreVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
  },
  scoreMuted: { color: colors.muted },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingTop: 8,
  },
  totalLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  totalVal: { fontFamily: fonts.barlowCondensed, fontSize: 22 },
  totalWinner: { color: colors.accent },
  totalLoser: { color: colors.text },
})
