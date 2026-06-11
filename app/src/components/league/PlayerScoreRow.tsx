import { View, Text, TextInput, StyleSheet } from 'react-native'
import { usePendingStore } from '../../stores/pendingStore'
import { initials } from '../../utils/helpers'
import { colors, fonts, radius } from '../../theme'

interface PlayerScoreRowProps {
  player: {
    name: string
    slot: number
    scores: Record<number, any>
    isFill?: boolean
    teamSlotId: string
    isOut: boolean
    isChampion: boolean
    effectiveAvg: number
  }
  gameNum: number
  mode: 'scores' | 'expected'
  leagueAvg: number
  /**
   * Called when the input loses focus (admins only). Used to flush pending
   * scores to the DB in the background — players leave this undefined so the
   * screen acts purely as a calculator for them.
   */
  onCommit?: () => void
  // When true the saved score is shown as static text (no inline editing) — used
  // where editing happens through the admin week editor instead of this row.
  readOnly?: boolean
}

export default function PlayerScoreRow({ player, gameNum, mode, leagueAvg, onCommit, readOnly }: PlayerScoreRowProps) {
  const { pendingScores, set } = usePendingStore()

  const expectedScore = player.effectiveAvg > 0 ? Math.round(player.effectiveAvg) : '—'

  const rawScore = player.scores[gameNum] ?? ''
  const pendingKey = `${player.teamSlotId}|${gameNum}`
  const pendingEntry = pendingScores[pendingKey]

  const hasPending = pendingEntry !== undefined
  const displayValue = hasPending
    ? pendingEntry
    : rawScore === '' || rawScore == null
    ? ''
    : String(rawScore)

  const hasValue = displayValue !== '' && displayValue != null
  const isPending = hasPending
  const isAbsentPrefill = player.isOut && rawScore !== '' && rawScore != null

  function onChangeText(val: string) {
    const initial = rawScore === '' || rawScore == null ? '' : String(rawScore)
    if (val === initial) {
      const next = { ...pendingScores }
      delete next[pendingKey]
      set({ pendingScores: next })
    } else {
      set({ pendingScores: { ...pendingScores, [pendingKey]: val } })
    }
  }

  return (
    <View style={[styles.row, player.isOut && styles.rowAbsent]}>
      <View style={[styles.avatar, player.isChampion && styles.avatarChamp]}>
        <Text style={styles.avatarText}>{player.isFill ? '∅' : initials(player.name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {player.isFill ? (
          <Text style={[styles.playerName, { color: colors.muted, fontStyle: 'italic' }]}>League Avg Fill</Text>
        ) : (
          <Text style={styles.playerName}>
            {player.name}
            {player.isChampion ? ' 👑' : ''}
            {player.isOut ? <Text style={styles.outTag}> OUT</Text> : null}
          </Text>
        )}
        {player.effectiveAvg > 0 && !player.isFill ? (
          <Text style={styles.subtext}>avg {player.effectiveAvg.toFixed(1)}</Text>
        ) : player.isFill ? (
          <Text style={styles.subtext}>fill</Text>
        ) : null}
      </View>
      <View style={styles.scoreGroup}>
        <Text style={styles.gameLabel}>G{gameNum}</Text>
        {player.isFill ? (
          <Text style={styles.scoreDisplay}>{hasValue ? displayValue : Math.round(leagueAvg)}</Text>
        ) : mode === 'expected' ? (
          <Text style={[styles.scoreDisplay, { color: colors.muted }]}>{expectedScore}</Text>
        ) : readOnly ? (
          <Text style={[styles.scoreDisplay, !hasValue && { color: colors.muted2 }]}>{hasValue ? displayValue : '—'}</Text>
        ) : (
          <TextInput
            style={[
              styles.scoreInput,
              hasValue && styles.scoreInputHasValue,
              isPending && styles.scoreInputPending,
              isAbsentPrefill && styles.scoreInputAbsent,
            ]}
            keyboardType="number-pad"
            placeholder="—"
            placeholderTextColor={colors.muted2}
            value={displayValue}
            onChangeText={onChangeText}
            onBlur={onCommit}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowAbsent: {
    opacity: 0.5,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.icon,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarChamp: {
    borderWidth: 1,
    borderColor: colors.gold,
  },
  avatarText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    letterSpacing: 0.5,
  },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
  },
  outTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.danger,
    letterSpacing: 1,
  },
  subtext: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  scoreGroup: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  scoreDisplay: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    minWidth: 40,
    textAlign: 'right',
  },
  scoreInput: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
    minWidth: 40,
    textAlign: 'right',
    paddingVertical: 0,
    paddingHorizontal: 4,
  },
  scoreInputHasValue: {
    color: colors.text,
  },
  scoreInputPending: {
    color: colors.accent,
    borderBottomColor: colors.accent,
  },
  scoreInputAbsent: {
    color: colors.muted,
    borderBottomColor: colors.border,
  },
})
