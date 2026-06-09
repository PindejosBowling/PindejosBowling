import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native'
import { colors, fonts, radius } from '../theme'
import { WeekEditor, Participant, RosterPlayer } from '../hooks/useWeekEditor'
import PlayerPickerModal from './PlayerPickerModal'

// ---------------------------------------------------------------------------
// Shared inline editor for one week, rendered PER GAME so each game's roster is
// edited independently (rosters can differ between games; a player can appear on
// two different teams the same night). Rendered (in edit mode) by both
// MatchupsScreen and HistoryScreen. All mutations go through `editor`
// (useWeekEditor); this component is presentational + local menu state.
// ---------------------------------------------------------------------------

interface Props {
  editor: WeekEditor
}

type Picker =
  | { kind: 'swap'; partId: string; gameNumber: number; currentPlayerId: string | null }
  | { kind: 'add'; gameNumber: number; teamId: string }
  | null

const FILL_LABEL = 'League Avg Fill'

export default function EditableWeek({ editor }: Props) {
  const { games, roster, leagueAvg } = editor
  const [menuPartId, setMenuPartId] = useState<string | null>(null)
  const [picker, setPicker] = useState<Picker>(null)

  // Resolve the participant behind the open action menu (search every game/team).
  const menuCtx = menuPartId ? findPart(editor, menuPartId) : null
  const fillPlaceholder = leagueAvg > 0 ? String(Math.round(leagueAvg)) : '—'

  function pickerItems(gameNumber: number, currentId: string | null): RosterPlayer[] {
    const taken = editor.playerIdsInGame(gameNumber)
    return roster.filter(p => !taken.has(p.id) || p.id === currentId)
  }

  function onPickerSelect(item: RosterPlayer) {
    if (picker?.kind === 'swap') editor.swapPlayer(picker.partId, item)
    else if (picker?.kind === 'add') editor.addPlayer(picker.gameNumber, picker.teamId, item)
    setPicker(null)
  }

  if (games.length === 0) {
    return <Text style={styles.emptyState}>No games scheduled for this week.</Text>
  }

  return (
    <View>
      {games.map(game => (
        <View key={game.gameId} style={styles.gameCard}>
          <Text style={styles.gameTitle}>
            Game {game.gameNumber} · Team {game.teamANumber} vs Team {game.teamBNumber}
          </Text>

          <TeamColumn
            label={`Team ${game.teamANumber}`}
            game={game.gameNumber}
            teamId={game.teamAId}
            editor={editor}
            fillPlaceholder={fillPlaceholder}
            onMenu={setMenuPartId}
            onAdd={() => setPicker({ kind: 'add', gameNumber: game.gameNumber, teamId: game.teamAId })}
          />

          <View style={styles.vsDivider}>
            <View style={styles.vsLine} />
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.vsLine} />
          </View>

          <TeamColumn
            label={`Team ${game.teamBNumber}`}
            game={game.gameNumber}
            teamId={game.teamBId}
            editor={editor}
            fillPlaceholder={fillPlaceholder}
            onMenu={setMenuPartId}
            onAdd={() => setPicker({ kind: 'add', gameNumber: game.gameNumber, teamId: game.teamBId })}
          />
        </View>
      ))}

      {/* Per-participant action menu */}
      <Modal visible={!!menuCtx} transparent animationType="fade" onRequestClose={() => setMenuPartId(null)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuPartId(null)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>
              {menuCtx ? (menuCtx.part.isFill ? FILL_LABEL : menuCtx.part.playerName) : ''}
            </Text>
            <MenuItem
              label="Swap player"
              onPress={() => {
                if (!menuCtx) return
                setPicker({ kind: 'swap', partId: menuCtx.part.partId, gameNumber: menuCtx.gameNumber, currentPlayerId: menuCtx.part.playerId })
                setMenuPartId(null)
              }}
            />
            <MenuItem
              label="Move to other team"
              onPress={() => { if (menuCtx) editor.moveToOtherTeam(menuCtx.part.partId); setMenuPartId(null) }}
            />
            {menuCtx?.part.playerId != null && (
              <MenuItem
                label="Make league fill"
                onPress={() => { if (menuCtx) editor.makeFill(menuCtx.part.partId); setMenuPartId(null) }}
              />
            )}
            <MenuItem
              label="Remove from game"
              danger
              onPress={() => { if (menuCtx) editor.removeParticipant(menuCtx.part.partId); setMenuPartId(null) }}
            />
            <MenuItem label="Cancel" muted onPress={() => setMenuPartId(null)} />
          </View>
        </TouchableOpacity>
      </Modal>

      <PlayerPickerModal
        visible={!!picker}
        title={picker?.kind === 'add' ? 'Add Player' : 'Swap Player'}
        items={picker ? pickerItems(picker.gameNumber, picker.kind === 'swap' ? picker.currentPlayerId : null) : []}
        onSelectItem={onPickerSelect}
        onClose={() => setPicker(null)}
      />
    </View>
  )
}

// Locate a participant by id across all games/teams (for the action menu).
function findPart(editor: WeekEditor, partId: string): { part: Participant; gameNumber: number; teamId: string } | null {
  for (const g of editor.games) {
    for (const teamId of [g.teamAId, g.teamBId]) {
      const part = editor.participants(g.gameNumber, teamId).find(p => p.partId === partId)
      if (part) return { part, gameNumber: g.gameNumber, teamId }
    }
  }
  return null
}

function TeamColumn({
  label, game, teamId, editor, fillPlaceholder, onMenu, onAdd,
}: {
  label: string
  game: number
  teamId: string
  editor: WeekEditor
  fillPlaceholder: string
  onMenu: (partId: string) => void
  onAdd: () => void
}) {
  const roster = editor.participants(game, teamId)
  const total = editor.teamTotal(game, teamId)
  return (
    <View style={styles.teamBlock}>
      <View style={styles.teamHeader}>
        <Text style={styles.teamLabel}>{label}</Text>
        <Text style={styles.teamTotal}>{total}</Text>
      </View>

      {roster.length === 0 ? (
        <Text style={styles.emptyTeam}>No players in this game.</Text>
      ) : (
        roster.map(p => (
          <View key={p.partId} style={styles.slotRow}>
            <TouchableOpacity style={styles.nameBtn} onPress={() => onMenu(p.partId)} activeOpacity={0.7}>
              <Text style={[styles.nameText, p.isFill && styles.fillName]} numberOfLines={1}>
                {p.isFill ? FILL_LABEL : p.playerName}
              </Text>
              <Text style={styles.nameChevron}>⋯</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.scoreInput, p.isFill && styles.fillInput]}
              value={p.score}
              onChangeText={(v) => editor.setScore(p.partId, v)}
              placeholder={p.isFill ? fillPlaceholder : '—'}
              placeholderTextColor={colors.muted2}
              keyboardType="number-pad"
              maxLength={3}
            />
            <TouchableOpacity style={styles.removeBtn} onPress={() => editor.removeParticipant(p.partId)} activeOpacity={0.7}>
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <View style={styles.addRow}>
        <TouchableOpacity style={styles.addBtn} onPress={onAdd} activeOpacity={0.7}>
          <Text style={styles.addBtnText}>+ Player</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={() => editor.addFill(game, teamId)} activeOpacity={0.7}>
          <Text style={styles.addBtnText}>+ Fill</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function MenuItem({ label, onPress, danger, muted }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.menuItemText, danger && styles.menuItemDanger, muted && styles.menuItemMuted]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  emptyState: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 24,
  },
  gameCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  gameTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.text,
    marginBottom: 8,
  },
  teamBlock: {
    paddingVertical: 4,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  teamLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  teamTotal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
  },
  emptyTeam: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 6,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  nameBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  nameText: {
    flexShrink: 1,
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
  },
  fillName: {
    color: colors.muted,
    fontStyle: 'italic',
  },
  nameChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.accent,
    marginLeft: 6,
  },
  scoreInput: {
    width: 56,
    marginHorizontal: 6,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    textAlign: 'center',
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
  },
  fillInput: {
    color: colors.gold,
  },
  removeBtn: {
    width: 28,
    alignItems: 'center',
    paddingVertical: 6,
  },
  removeText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.danger,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  addBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.cardSm,
    borderStyle: 'dashed',
  },
  addBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  vsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 8,
  },
  vsLine: { flex: 1, height: 1, backgroundColor: colors.border },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted2,
    letterSpacing: 1,
  },

  // action menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  menuTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.text,
    marginBottom: 8,
  },
  menuItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemText: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  menuItemDanger: { color: colors.danger },
  menuItemMuted: { color: colors.muted },
})
