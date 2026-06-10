import { Fragment, useState, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'

// One row in the section. `pinned` rows stay visible even when the section is
// collapsed (e.g. a line that's in the parlay slip), so players can keep building
// across collapsed sections. `render(isLast)` receives whether it's the last
// *visible* row, so borders stay correct as the visible set changes.
export interface CollapsibleRow {
  key: string
  pinned?: boolean
  render: (isLast: boolean) => ReactNode
}

interface LineRowContainerProps {
  title: string             // section header (e.g. a LineCategory label — "Player Over/Unders")
  count: number             // number of lines inside — shown on the collapsed bar
  note?: string             // optional sub-note shown above the rows when expanded (in-progress copy)
  defaultCollapsed?: boolean
  // Game in progress: the header can't be toggled and the section stays collapsed
  // (pinned rows still show, inert). The in-progress warning renders at the game
  // level on the board, not per-section.
  disabled?: boolean
  rows: CollapsibleRow[]
}

// A collapsible section wrapping a set of related rows. Owns its own collapse
// state so each container toggles independently of the others; the header bar
// always shows the section title + line count. When collapsed it still renders
// any `pinned` rows (selected legs) so they remain visible under the header.
// Presentational — callers build the row elements and the pinned flags.
export default function LineRowContainer({
  title,
  count,
  note,
  defaultCollapsed = false,
  disabled = false,
  rows,
}: LineRowContainerProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const effectiveCollapsed = disabled || collapsed

  // Collapsed: only pinned rows remain. Expanded: everything.
  const visible = effectiveCollapsed ? rows.filter(r => r.pinned) : rows
  const pinnedCount = rows.reduce((n, r) => n + (r.pinned ? 1 : 0), 0)
  const lineCount = `${count} ${count === 1 ? 'LINE' : 'LINES'}`

  return (
    <View>
      <TouchableOpacity
        style={[styles.header, disabled && styles.headerDisabled]}
        onPress={() => setCollapsed(c => !c)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text style={styles.title}>{title}</Text>
        <View style={styles.right}>
          <Text style={styles.count}>
            {pinnedCount > 0 ? (
              <>
                <Text style={styles.selected}>{pinnedCount} SELECTED</Text>
                {` · ${lineCount}`}
              </>
            ) : lineCount}
          </Text>
          <Text style={styles.chevron}>{effectiveCollapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>
      {visible.length > 0 && (
        <>
          {!effectiveCollapsed && note && <Text style={styles.note}>{note}</Text>}
          <View style={styles.card}>
            {visible.map((r, idx) => (
              <Fragment key={r.key}>{r.render(idx === visible.length - 1)}</Fragment>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Tappable summary bar — the primary affordance when collapsed (the default).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  headerDisabled: { opacity: 0.5 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    letterSpacing: 0.3,
    color: colors.text,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  count: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.muted,
  },
  selected: { color: colors.accent },
  chevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    width: 14,
    textAlign: 'center',
  },
  note: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gold,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
})
