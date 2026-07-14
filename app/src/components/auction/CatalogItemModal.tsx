import { useMemo, useState } from 'react'
import { View, Text, TextInput, Switch, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import ToggleGroup from '../ui/ToggleGroup'
import { useUiStore } from '../../stores/uiStore'
import {
  CATALOG_ACTIVATION_MODES, CATALOG_EFFECT_TYPES, CatalogItemAdminView,
} from '../../utils/auction'
import { itemCatalog } from '../../utils/supabase/db'

interface Props {
  // Admin create/edit of an item_catalog row. The functional columns
  // (effect type / params / activation mode) freeze once any instance exists —
  // the DB RPC enforces it; this form disables those fields to mirror the
  // guard. Changed behavior = a NEW item key. Mount conditionally.
  initial?: CatalogItemAdminView
  onClose: () => void
  onDone: () => void
}

export default function CatalogItemModal({ initial, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const editing = initial != null
  const frozen = editing && initial.instanceCount > 0

  const [key, setKey] = useState(initial?.key ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [effectType, setEffectType] = useState(initial?.effectType ?? 'custom')
  const [activationMode, setActivationMode] = useState(initial?.activationMode ?? 'admin_honored')
  const [paramsText, setParamsText] = useState(() =>
    JSON.stringify(initial?.effectParams ?? {}))
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const paramsError = useMemo(() => {
    try {
      const v = JSON.parse(paramsText || '{}')
      return v != null && typeof v === 'object' && !Array.isArray(v) ? null : 'Params must be a JSON object'
    } catch {
      return 'Params must be valid JSON'
    }
  }, [paramsText])

  const error = useMemo<string | null>(() => {
    if (!editing && !/^[a-z0-9_]+$/.test(key)) return 'Key must be lowercase snake_case'
    if (!name.trim()) return 'Add a name'
    if (!icon.trim()) return 'Add an icon (emoji)'
    if (!description.trim()) return 'Add a description'
    return paramsError
  }, [editing, key, name, icon, description, paramsError])

  async function submit() {
    if (saving || error) return
    setSaving(true)
    try {
      const input = {
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim(),
        effectType,
        effectParams: JSON.parse(paramsText || '{}'),
        activationMode,
      }
      const { error: rpcErr } = editing
        ? await itemCatalog.update(initial.id, input, isActive)
        : await itemCatalog.create(key.trim(), input)
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast(editing ? 'Item updated' : 'Item created', 'success')
      onDone()
      onClose()
    } catch {
      showToast(editing ? 'Failed to update item' : 'Failed to create item', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={editing ? `Edit ${initial.icon} ${initial.name}` : 'New Catalog Item'}
      subtitle={frozen ? `${initial.instanceCount} granted — behavior is frozen` : 'Defines what the House can sell or grant'}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label={editing ? 'Save Item' : 'Create Item'}
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
      {!editing && (
        <>
          <Text style={styles.label}>KEY (PERMANENT)</Text>
          <TextInput
            style={styles.input}
            value={key}
            onChangeText={t => setKey(t.toLowerCase())}
            placeholder="e.g. golden_ticket_v2"
            placeholderTextColor={colors.muted2}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <Text style={styles.label}>ICON · NAME</Text>
      <View style={styles.rowPair}>
        <TextInput
          style={[styles.input, styles.iconInput]}
          value={icon}
          onChangeText={setIcon}
          placeholder="🎫"
          placeholderTextColor={colors.muted2}
        />
        <TextInput
          style={[styles.input, styles.nameInput]}
          value={name}
          onChangeText={setName}
          placeholder="Item name"
          placeholderTextColor={colors.muted2}
        />
      </View>

      <Text style={styles.label}>DESCRIPTION</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="The pitch — players see this everywhere the item appears."
        placeholderTextColor={colors.muted2}
        multiline
        maxLength={300}
      />

      <Text style={styles.label}>EFFECT TYPE{frozen ? ' (FROZEN)' : ''}</Text>
      {frozen ? (
        <Text style={styles.frozenValue}>{effectType.replace(/_/g, ' ')}</Text>
      ) : (
        <ToggleGroup
          options={CATALOG_EFFECT_TYPES.map(t => ({ key: t, label: t.replace('_', ' ') }))}
          value={effectType}
          onChange={setEffectType}
        />
      )}

      <Text style={styles.label}>ACTIVATION{frozen ? ' (FROZEN)' : ''}</Text>
      {frozen ? (
        <Text style={styles.frozenValue}>{activationMode.replace(/_/g, ' ')}</Text>
      ) : (
        <ToggleGroup
          options={CATALOG_ACTIVATION_MODES.map(m => ({ key: m, label: m.replace(/_/g, ' ') }))}
          value={activationMode}
          onChange={setActivationMode}
        />
      )}

      <Text style={styles.label}>EFFECT PARAMS (JSON){frozen ? ' (FROZEN)' : ''}</Text>
      <TextInput
        style={[styles.input, styles.mono]}
        value={paramsText}
        onChangeText={setParamsText}
        editable={!frozen && !saving}
        placeholder='{"refund_share": 1.0}'
        placeholderTextColor={colors.muted2}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {editing && (
        <View style={styles.activeRow}>
          {/* Retirement stops new grants/auctions; it never confiscates. */}
          <Text style={styles.activeLabel}>Active (grantable & auctionable)</Text>
          <Switch
            value={isActive}
            onValueChange={setIsActive}
            disabled={saving}
            trackColor={{ false: colors.surface3, true: colors.accentDim }}
            thumbColor={isActive ? colors.accent : colors.muted}
          />
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 12, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  rowPair: { flexDirection: 'row', gap: 8 },
  iconInput: { width: 64, textAlign: 'center' },
  nameInput: { flex: 1 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  mono: { fontSize: 13 },
  frozenValue: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.muted, paddingVertical: 4 },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  activeLabel: { flex: 1, fontFamily: fonts.barlow, fontSize: 14, color: colors.text, marginRight: 10 },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 10 },
  submitBtn: { marginTop: 14 },
})
