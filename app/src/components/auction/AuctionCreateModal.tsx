import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { AuctionView, CatalogItemView, DEFAULT_BOUNCE_FEE, defaultAuctionCloseAt, itemHowToUse } from '../../utils/auction'
import { formatCloseTime } from '../../utils/bounty'
import { auctions, itemCatalog } from '../../utils/supabase/db'

interface Props {
  // Admin create/edit. All fields editable at create; metadata frozen once the
  // auction opens (edit is offered for scheduled auctions only). No drafts —
  // creating lands directly in scheduled/open. Mount conditionally; pass
  // `initial` for Edit.
  initial?: AuctionView
  onClose: () => void
  onDone: () => void
}

export default function AuctionCreateModal({ initial, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const editing = initial != null

  const [catalog, setCatalog] = useState<CatalogItemView[]>([])
  const [itemKey, setItemKey] = useState(initial?.itemKey ?? '')
  const [minimumBid, setMinimumBid] = useState(initial ? String(initial.minimumBid) : '')
  const [quantityText, setQuantityText] = useState(initial ? String(initial.quantity) : '1')
  const [opensAt, setOpensAt] = useState<Date>(() => (initial ? new Date(initial.opensAt) : new Date()))
  const [closesAt, setClosesAt] = useState<Date>(() =>
    initial ? new Date(initial.closesAt) : defaultAuctionCloseAt())
  const [pickerFor, setPickerFor] = useState<'opens' | 'closes' | null>(null)
  const [saving, setSaving] = useState(false)

  // Active catalog rows feed the item chips; default the selection to the
  // first item once loaded (create mode only — edit keeps the auction's item).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await itemCatalog.listActive()
      if (cancelled || !data) return
      const items = data.map((c: any): CatalogItemView => ({
        key: c.key, icon: c.icon, name: c.name,
        effectLine: c.description, howToUse: itemHowToUse(c.activation_mode),
      }))
      setCatalog(items)
      setItemKey(prev => (prev ? prev : items[0]?.key ?? ''))
    })()
    return () => { cancelled = true }
  }, [])

  const minBid = Number(minimumBid) || 0
  const quantity = Number(quantityText) || 0

  // The auction's description is the item's catalog copy — derived, never
  // typed. The card and detail page pitch the item in its own voice.
  const selectedItem = useMemo(() => catalog.find(c => c.key === itemKey) ?? null, [catalog, itemKey])

  const error = useMemo<string | null>(() => {
    if (!itemKey) return 'Pick an item'
    if (minBid <= 0) return 'Minimum bid must be at least 1'
    if (quantity < 1 || quantity > 50) return 'Quantity must be 1–50'
    if (closesAt.getTime() <= Date.now()) return 'Close time must be in the future'
    if (closesAt.getTime() <= opensAt.getTime()) return 'Close time must be after open time'
    return null
  }, [itemKey, minBid, quantity, opensAt, closesAt])

  async function submit() {
    if (saving || error || !selectedItem) return
    setSaving(true)
    try {
      const input = {
        catalogKey: itemKey,
        description: selectedItem.effectLine,
        minimumBid: minBid,
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
        quantity,
      }
      const { error: rpcErr } = editing ? await auctions.update(initial.id, input) : await auctions.create(input)
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast(editing ? 'Auction updated' : 'Auction created', 'success')
      onDone()
      onClose()
    } catch {
      showToast(editing ? 'Failed to update auction' : 'Failed to create auction', 'error')
    } finally {
      setSaving(false)
    }
  }

  function onPickerValue(_e: unknown, selected?: Date) {
    const target = pickerFor
    if (Platform.OS === 'android') setPickerFor(null)
    if (!selected || !target) return
    if (target === 'opens') setOpensAt(selected)
    else setClosesAt(selected)
  }

  return (
    <BottomSheet
      title={editing ? 'Edit Auction' : 'New Auction'}
      subtitle="The House puts an item on the block"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      bodyMaxHeight={460}
      footer={
        <>
          <Button
            label={editing ? 'Save Auction' : 'Create Auction'}
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
      <Text style={styles.label}>ITEM</Text>
      <View style={styles.itemRow}>
        {catalog.map(c => (
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

      {selectedItem && (
        <Text style={styles.itemCopy}>{selectedItem.effectLine}</Text>
      )}

      <Text style={styles.label}>MINIMUM BID</Text>
      <TextInput
        style={styles.input}
        value={minimumBid}
        onChangeText={t => setMinimumBid(t.replace(/[^0-9]/g, ''))}
        placeholder="e.g. 100"
        placeholderTextColor={colors.muted2}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>QUANTITY</Text>
      <TextInput
        style={styles.input}
        value={quantityText}
        onChangeText={t => setQuantityText(t.replace(/[^0-9]/g, ''))}
        placeholder="1"
        placeholderTextColor={colors.muted2}
        keyboardType="number-pad"
      />
      {quantity > 1 && (
        <Text style={styles.quantityNote}>
          Top {quantity} sealed bids each win one — every winner pays their own pledge.
        </Text>
      )}

      <Text style={styles.label}>OPENS</Text>
      <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor(p => (p === 'opens' ? null : 'opens'))} activeOpacity={0.8}>
        <Text style={styles.dateBtnText}>{formatCloseTime(opensAt.toISOString())}</Text>
        <Text style={styles.dateBtnChevron}>›</Text>
      </TouchableOpacity>

      <Text style={styles.label}>CLOSES (SETTLES IMMEDIATELY)</Text>
      <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor(p => (p === 'closes' ? null : 'closes'))} activeOpacity={0.8}>
        <Text style={styles.dateBtnText}>{formatCloseTime(closesAt.toISOString())}</Text>
        <Text style={styles.dateBtnChevron}>›</Text>
      </TouchableOpacity>

      {pickerFor && (
        <DateTimePicker
          value={pickerFor === 'opens' ? opensAt : closesAt}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={pickerFor === 'closes' ? new Date() : undefined}
          onChange={onPickerValue}
          themeVariant="dark"
        />
      )}

      {/* The bounce fee is a rule, not a knob — shown so the admin knows the terms. */}
      <Text style={styles.bounceNote}>Bounce penalty: min(balance, {initial?.bounceFee ?? DEFAULT_BOUNCE_FEE}) pins — fixed by the House.</Text>

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
  itemCopy: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, marginTop: 10, lineHeight: 18 },
  quantityNote: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  dateBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  dateBtnChevron: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.muted },
  bounceNote: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 14, lineHeight: 17 },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 10 },
  submitBtn: { marginTop: 14 },
})
