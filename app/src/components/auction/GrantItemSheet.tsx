import { useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import Dropdown from '../ui/Dropdown'
import { PlayerPickerItem } from '../ui/PlayerPickerModal'
import { useUiStore } from '../../stores/uiStore'
import { CatalogItemAdminView } from '../../utils/auction'
import { inventoryItems } from '../../utils/supabase/db'

interface Props {
  // Admin grant: hand a player N atomic copies of an active catalog item
  // (source = admin_grant, current season — the RPC owns the rules). Mount
  // conditionally.
  playerOptions: PlayerPickerItem[]
  catalog: CatalogItemAdminView[]
  onClose: () => void
  onDone: () => void
}

export default function GrantItemSheet({ playerOptions, catalog, onClose, onDone }: Props) {
  const { showToast } = useUiStore()

  const grantable = useMemo(() => catalog.filter(c => c.isActive), [catalog])
  const [playerId, setPlayerId] = useState('')
  const [itemKey, setItemKey] = useState(grantable[0]?.key ?? '')
  const [quantityText, setQuantityText] = useState('1')
  const [saving, setSaving] = useState(false)

  const quantity = Number(quantityText) || 0

  const error = useMemo<string | null>(() => {
    if (!playerId) return 'Pick a player'
    if (!itemKey) return 'Pick an item'
    if (quantity < 1 || quantity > 50) return 'Quantity must be 1–50'
    return null
  }, [playerId, itemKey, quantity])

  async function submit() {
    if (saving || error || !playerId) return
    setSaving(true)
    try {
      const { error: rpcErr } = await inventoryItems.grant(playerId, itemKey, quantity)
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast('Item granted', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to grant item', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Grant Item"
      subtitle="The House hands a player an item — no pins move"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      bodyMaxHeight={420}
      footer={
        <>
          <Button
            label="Grant"
            size="lg"
            onPress={submit}
            loading={saving}
            disabled={!!error || saving}
            style={styles.submitBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <Text style={styles.label}>PLAYER</Text>
      <Dropdown
        options={[
          { key: '', label: 'Select player…' },
          ...playerOptions.map(p => ({ key: p.id, label: p.name })),
        ]}
        value={playerId}
        onChange={setPlayerId}
        disabled={saving}
      />

      <Text style={styles.label}>ITEM</Text>
      <View style={styles.itemRow}>
        {grantable.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.itemChip, itemKey === c.key && styles.itemChipActive]}
            onPress={() => setItemKey(c.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.itemChipText, itemKey === c.key && styles.itemChipTextActive]}>
              {c.icon} {c.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>QUANTITY</Text>
      <TextInput
        style={styles.input}
        value={quantityText}
        onChangeText={t => setQuantityText(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="1"
        placeholderTextColor={colors.muted2}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 12, marginBottom: 8 },
  itemRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemChip: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  itemChipActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  itemChipText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted },
  itemChipTextActive: { color: colors.accent },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 10 },
  submitBtn: { marginTop: 14 },
})
