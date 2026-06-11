import { StyleSheet } from 'react-native'
import ToggleGroup from './ToggleGroup'

interface Props {
  // The game numbers available to pick this week (e.g. [1, 2]).
  games: number[]
  // Currently selected game number, or null when none is chosen.
  value: number | null
  onChange: (n: number) => void
  // Shown in place of the pills when no games are scheduled.
  emptyText?: string
}

// Shared game-number selector — a thin wrapper over ToggleGroup mapping game
// numbers ↔ string keys, so a game can only be chosen from what's actually
// scheduled (never typed in free form). Used by the PvP create screen and the
// counter modal to keep selection consistent and valid.
export default function GamePicker({ games, value, onChange, emptyText = 'No games scheduled this week.' }: Props) {
  return (
    <ToggleGroup
      options={games.map(n => ({ key: String(n), label: `Game ${n}` }))}
      value={value != null ? String(value) : null}
      onChange={k => onChange(Number(k))}
      empty={emptyText}
      style={styles.row}
    />
  )
}

const styles = StyleSheet.create({
  row: { justifyContent: 'flex-start', flexWrap: 'wrap' },
})
