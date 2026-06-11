import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'

interface Props {
  // The game numbers available to pick this week (e.g. [1, 2]).
  games: number[]
  // Currently selected game number, or null when none is chosen.
  value: number | null
  onChange: (n: number) => void
  // Shown in place of the pills when no games are scheduled.
  emptyText?: string
}

// Shared game-number selector — renders the available games as pill buttons so a
// game can only be chosen from what's actually scheduled (never typed in free
// form). Used by the create screen and the counter modal to keep selection
// consistent and valid.
export default function GamePicker({ games, value, onChange, emptyText = 'No games scheduled this week.' }: Props) {
  if (games.length === 0) return <Text style={styles.empty}>{emptyText}</Text>
  return (
    <View style={styles.row}>
      {games.map(n => (
        <TouchableOpacity
          key={n}
          style={[styles.btn, value === n && styles.btnOn]}
          onPress={() => onChange(n)}
          activeOpacity={0.7}
        >
          <Text style={[styles.btnText, value === n && styles.btnTextOn]}>Game {n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  btnOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  btnText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.5 },
  btnTextOn: { color: colors.accent },
  empty: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
})
