import { StyleSheet, StyleProp, ViewStyle } from 'react-native'
import ToggleGroup from './ToggleGroup'

interface PillFilterProps {
  items: string[]
  value: string
  onChange: (item: string) => void
  renderLabel?: (item: string) => string
  style?: StyleProp<ViewStyle>
}

// Horizontal scrollable filter bar — a thin wrapper over ToggleGroup's 'pill'
// variant keeping the string-list API used by the filter screens.
export default function PillFilter({ items, value, onChange, renderLabel, style }: PillFilterProps) {
  return (
    <ToggleGroup
      options={items.map(item => ({ key: item, label: renderLabel ? renderLabel(item) : item }))}
      value={value}
      onChange={onChange}
      variant="pill"
      scrollable
      style={[styles.row, style]}
    />
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 10 },
})
