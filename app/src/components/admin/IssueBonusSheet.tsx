import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { useUiStore } from '../../stores/uiStore'
import { players, seasons, seasonChampions, bonuses } from '../../utils/supabase/db'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PlayerPickerModal, { PlayerPickerItem } from '../ui/PlayerPickerModal'
import PlayerAvatar from '../ui/PlayerAvatar'
import PinAmountInput from '../ui/PinAmountInput'

interface Props {
  onClose: () => void
  // Called after a successful issuance so the screen can reload its ledger.
  onIssued: () => void | Promise<void>
}

// Admin sheet for handing out a house-funded `bonus` to one or more players.
// Generic by design (pick players + amount + label), with a one-tap "Reigning
// Champion" preset that pre-fills last-ended season's champions + a 100-pin
// default. Conditionally mounted by the caller (`{open && <IssueBonusSheet/>}`)
// so its state resets between opens. The bonus lands in the current season and
// posts a Market Moves event — all server-side in issue_pin_bonus.
export default function IssueBonusSheet({ onClose, onIssued }: Props) {
  const { showToast } = useUiStore()

  const [allPlayers, setAllPlayers] = useState<PlayerPickerItem[]>([])
  const [selected, setSelected] = useState<PlayerPickerItem[]>([])
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reigning-champion preset, resolved once on open. Null until loaded / if
  // there's no last-ended season with champions.
  const [champPreset, setChampPreset] = useState<{ label: string; items: PlayerPickerItem[] } | null>(null)

  useEffect(() => {
    players.listActive().then(({ data }) => {
      setAllPlayers((data ?? []).map(p => ({ id: p.id, name: p.name ?? 'Unknown' })))
    })
    seasons.getLastEnded().then(async ({ data: lastEnded }) => {
      if (!lastEnded) return
      const { data: champs } = await seasonChampions.listBySeason(lastEnded.id)
      if (!champs || champs.length === 0) return
      setChampPreset({
        label: `Season ${lastEnded.number} Champion`,
        items: champs.map((c: any) => ({ id: c.player_id, name: c.players?.name ?? 'Champion' })),
      })
    })
  }, [])

  function applyChampionPreset() {
    if (!champPreset) return
    setSelected(champPreset.items)
    setLabel(champPreset.label)
    if (!amount) setAmount('100')
  }

  function addPlayer(item: PlayerPickerItem) {
    setSelected(prev => (prev.some(p => p.id === item.id) ? prev : [...prev, item]))
    setPickerOpen(false)
  }

  function removePlayer(id: string) {
    setSelected(prev => prev.filter(p => p.id !== id))
  }

  const amountNum = Number(amount)
  const canSubmit = selected.length > 0 && amountNum > 0 && label.trim().length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    const { error } = await bonuses.issue(selected.map(p => p.id), amountNum, label.trim())
    if (error) {
      showToast(error.message, 'error')
      setSaving(false)
      return
    }
    showToast(
      `Issued ${amountNum.toLocaleString()} pins to ${selected.length} ${selected.length === 1 ? 'player' : 'players'}`,
      'success',
    )
    await onIssued()
    onClose()
  }

  // Players not already selected — the picker only offers new ones.
  const pickable = allPlayers.filter(p => !selected.some(s => s.id === p.id))

  return (
    <>
      <BottomSheet
        title="Issue Bonus"
        subtitle="House-funded pins credited to the current season"
        onClose={onClose}
        busy={saving}
        keyboardAvoiding
        footer={
          <View style={styles.footer}>
            <Button label="Cancel" variant="secondary" onPress={onClose} fullWidth />
            <Button label="Issue Bonus" variant="gold" onPress={submit} loading={saving} disabled={!canSubmit} fullWidth />
          </View>
        }
      >
        {champPreset && (
          <TouchableOpacity style={styles.preset} activeOpacity={0.8} onPress={applyChampionPreset}>
            <Text style={styles.presetIcon}>👑</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.presetTitle}>Reigning Champion</Text>
              <Text style={styles.presetSub}>{champPreset.label} · {champPreset.items.length} players · 100 pins</Text>
            </View>
            <Text style={styles.presetApply}>USE</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.fieldLabel}>RECIPIENTS</Text>
        {selected.length > 0 && (
          <View style={styles.chips}>
            {selected.map(p => (
              <TouchableOpacity key={p.id} style={styles.chip} activeOpacity={0.7} onPress={() => removePlayer(p.id)}>
                <PlayerAvatar name={p.name} size={20} style={styles.chipAvatar} />
                <Text style={styles.chipName}>{p.name}</Text>
                <Text style={styles.chipRemove}>✕</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Button
          selectable
          value={null}
          placeholder="+ Add player"
          onPress={() => setPickerOpen(true)}
          fullWidth
        />

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>AMOUNT (PINS)</Text>
        <PinAmountInput
          value={amount}
          onChangeText={setAmount}
          placeholder="e.g. 100"
          maxLength={7}
        />

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>LABEL</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Season 2 Champion"
          placeholderTextColor={colors.muted2}
          maxLength={60}
        />
        <Text style={styles.note}>Shown on both sides of the ledger and in the Market Moves feed.</Text>
      </BottomSheet>

      {pickerOpen && (
        <PlayerPickerModal
          visible
          title="Add Recipient"
          items={pickable}
          onSelectItem={addPlayer}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 10, marginTop: 20 },

  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.gold,
    padding: 12,
    marginBottom: 18,
  },
  presetIcon: { fontSize: 22 },
  presetTitle: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, fontWeight: '700' },
  presetSub: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 1 },
  presetApply: { fontFamily: fonts.barlowCondensed, fontSize: 13, letterSpacing: 1.5, color: colors.gold },

  fieldLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 10,
  },
  chipAvatar: {},
  chipName: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text },
  chipRemove: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted },

  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
})
