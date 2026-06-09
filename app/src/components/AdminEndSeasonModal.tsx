import { useState, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { players, seasons, seasonChampions } from '../utils/supabase/db'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import Button from './Button'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function AdminEndSeasonModal({ visible, onClose }: Props) {
  const [championIds, setChampionIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [playerList, setPlayerList] = useState<{ id: string; name: string | null }[]>([])
  const [season, setSeason] = useState<{ id: string; number: number } | null>(null)
  const { showToast } = useUiStore()

  useEffect(() => {
    if (!visible) return
    Promise.all([players.listActive(), seasons.getCurrent()]).then(([pRes, sRes]) => {
      setPlayerList(pRes.data ?? [])
      setSeason(sRes.data ? { id: sRes.data.id, number: sRes.data.number } : null)
    })
  }, [visible])

  function toggleChampion(id: string) {
    setChampionIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function submit() {
    if (!season) return
    setSaving(true)
    try {
      // Pay down active loans (min(balance, debt)) before the season is marked
      // ended, so final standings reflect post-settlement net worth. Abort on
      // error — don't close a season with unsettled loans.
      const { error: loanError } = await seasons.settleLoansForClose(season.id)
      if (loanError) { showToast(loanError.message, 'error'); setSaving(false); return }

      const { error: seasonError } = await seasons.update(season.id, { is_active: false })
      if (seasonError) { showToast(seasonError.message, 'error'); setSaving(false); return }

      for (const playerId of championIds) {
        const { error } = await seasonChampions.insert({ player_id: playerId, season_id: season.id })
        if (error) { showToast(error.message, 'error'); setSaving(false); return }
      }

      showToast(`Season ${season.number} closed`, 'success')
      setChampionIds([])
      onClose()
    } catch {
      showToast('Failed to end season', 'error')
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    setChampionIds([])
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>End Season {season?.number ?? '…'}</Text>
          <Text style={styles.subtitle}>
            Choose champion(s). For team championships, select all members.{'\n'}
            Season will be marked as ended.
          </Text>

          <ScrollView style={styles.playerList} contentContainerStyle={{ paddingVertical: 4 }}>
            {playerList.map(player => {
              const selected = championIds.includes(player.id)
              return (
                <TouchableOpacity
                  key={player.id}
                  style={styles.playerRow}
                  onPress={() => toggleChampion(player.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.playerName, selected && styles.playerNameSelected]}>
                    {player.name}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          <View style={styles.btnRow}>
            <Button label="Cancel" variant="secondary" onPress={handleClose} fullWidth />
            <Button
              label="End Season"
              onPress={submit}
              loading={saving}
              disabled={saving}
              fullWidth
            />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
      {/* Rendered inside the Modal so toasts aren't occluded by the native modal layer. */}
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
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
    marginBottom: 16,
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
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
})
