import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import PlayerAvatar from '../ui/PlayerAvatar'

interface Player {
  name: string
  score?: number | string
  present: boolean
  isFill?: boolean
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

      {players.map((p, i) => (
        <View key={`${p.name}-${i}`} style={[styles.playerRow, !p.present && styles.playerRowAbsent]}>
          {p.isFill ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>∅</Text>
            </View>
          ) : (
            <PlayerAvatar name={p.name} size={28} style={styles.avatarSpacing} />
          )}
          <Text style={[styles.playerName, (!p.present || p.isFill) && styles.playerNameAbsent, p.isFill && styles.playerNameFill]} numberOfLines={1}>
            {p.isFill ? 'League Avg Fill' : p.name}{!p.present ? ' ' : ''}
            {!p.present ? <Text style={styles.absentTag}>OUT</Text> : null}
          </Text>
          <View style={styles.scoreGroup}>
            <Text style={styles.scoreLabel}>{p.isFill ? 'Fill' : 'Score'}</Text>
            <Text style={[styles.scoreVal, p.isFill && styles.scoreFill, !p.score && styles.scoreMuted]}>
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
  avatarSpacing: { marginRight: 10 },
  playerName: { flex: 1, fontFamily: fonts.barlow, fontSize: 14, color: colors.text },
  playerNameAbsent: { color: colors.muted },
  playerNameFill: { fontStyle: 'italic' },
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
  scoreFill: { color: colors.gold },

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
