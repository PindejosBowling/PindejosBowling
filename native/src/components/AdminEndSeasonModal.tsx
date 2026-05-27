import { useState, useMemo } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import { apiPost } from '../api.js'
import { getCurrentSeason, aggregateStandings } from '../utils/data.js'
import { colors, fonts, radius } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function AdminEndSeasonModal({ visible, onClose }: Props) {
  const [champions, setChampions] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { loadAll, stats, settings, roster } = useDataStore()
  const { showToast } = useUiStore()

  const seasonNum = useMemo(() => {
    return parseInt(getCurrentSeason(stats, settings)) || 1
  }, [stats, settings])

  const allPlayers = useMemo(() => {
    const standings = aggregateStandings(stats, String(seasonNum))
    const fromStandings = standings.map((p: any) => p.name)
    const fromRoster = roster
      ? roster.slice(1).filter((r: any) => r[0]).map((r: any) => r[0])
      : []
    return Array.from(new Set([...fromStandings, ...fromRoster])).sort() as string[]
  }, [stats, settings, roster, seasonNum])

  function toggleChampion(name: string) {
    setChampions(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  async function submit() {
    setSaving(true)
    try {
      const r = await apiPost('endSeason', { champions, notes: notes.trim() })
      if (r.error) { showToast(r.error, 'error'); setSaving(false); return }
      showToast(`Season ${r.season} closed`, 'success')
      await loadAll()
      setChampions([])
      setNotes('')
      onClose()
    } catch {
      showToast('Failed to end season', 'error')
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    setChampions([])
    setNotes('')
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>End Season {seasonNum}</Text>
          <Text style={styles.subtitle}>
            Choose champion(s). For team championships, select all members.{'\n'}
            Season will roll over to {seasonNum + 1} and current week resets to 1.
          </Text>

          <ScrollView style={styles.playerList} contentContainerStyle={{ paddingVertical: 4 }}>
            {allPlayers.map(player => {
              const selected = champions.includes(player)
              return (
                <TouchableOpacity
                  key={player}
                  style={styles.playerRow}
                  onPress={() => toggleChampion(player)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.playerName, selected && styles.playerNameSelected]}>
                    {player}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={handleClose}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={submit}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>End Season</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 14,
  },
  playerList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardSm,
    marginBottom: 12,
    maxHeight: 220,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  checkmark: {
    fontSize: 13,
    color: colors.bg,
    fontWeight: '700',
    lineHeight: 15,
  },
  playerName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  playerNameSelected: {
    color: colors.gold,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    marginBottom: 16,
  },
  notesInput: {
    minHeight: 64,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  btnCancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.4,
  },
})
