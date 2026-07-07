import { StyleSheet, StyleProp, ViewStyle } from 'react-native'
import Dropdown from './Dropdown'

interface SeasonDropdownProps {
  /** Season numbers as strings (any order — rendered newest-first). */
  seasons: string[]
  /** 'all' or a season number string. */
  value: string
  onChange: (value: string) => void
  /** Prepend the "All Time" option (default true). */
  includeAllTime?: boolean
  style?: StyleProp<ViewStyle>
}

// Season selector — a full-width anchored Dropdown replacing the old season
// pill rows. Shows the active choice ("Season N" / "All Time"); tapping opens
// the menu of All Time + every listed season, newest first.
export default function SeasonDropdown({ seasons, value, onChange, includeAllTime = true, style }: SeasonDropdownProps) {
  const options = [
    ...(includeAllTime ? [{ key: 'all', label: 'All Time' }] : []),
    ...seasons
      .slice()
      .sort((a, b) => Number(b) - Number(a))
      .map(n => ({ key: n, label: `Season ${n}` })),
  ]
  return <Dropdown options={options} value={value} onChange={onChange} style={[styles.trigger, style]} />
}

const styles = StyleSheet.create({
  // Match the spacing of the pill rows this replaces; spread label and caret
  // across the full-width trigger.
  trigger: {
    marginHorizontal: 16,
    marginVertical: 10,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
})
