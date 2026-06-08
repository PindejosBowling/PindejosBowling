import { useState, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import { usePlayerManagementData } from '../hooks/usePlayerManagementData'
import { useRefresh } from '../hooks/useRefresh'
import { useUiStore } from '../stores/uiStore'
import { players } from '../utils/supabase/db'
import { Tables } from '../utils/supabase/database.types'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type Player = Tables<'players'>

interface EditState {
  id: string | null
  firstName: string
  lastName: string
  phone: string | null
  is_active: boolean
  jersey_purchased: boolean
}

const EMPTY_EDIT: EditState = { id: null, firstName: '', lastName: '', phone: '', is_active: true, jersey_purchased: false }

// Normalize to E.164 (+1XXXXXXXXXX for US). Returns null if input is blank.
function normalizePhone(raw: string | null): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export default function PlayerManagementScreen() {
  const navigation = useNavigation<Nav>()
  const { loading, rawPlayers, reload } = usePlayerManagementData()
  const { refreshing, onRefresh } = useRefresh(reload)
  const { showToast } = useUiStore()
  const insets = useSafeAreaInsets()

  const [editModal, setEditModal] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  const { active, inactive } = useMemo(() => {
    const sorted = [...rawPlayers].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return {
      active: sorted.filter(p => p.is_active),
      inactive: sorted.filter(p => !p.is_active),
    }
  }, [rawPlayers])

  function openAdd() {
    setEditModal({ ...EMPTY_EDIT })
  }

  function openEdit(player: Player) {
    setEditModal({ id: player.id, firstName: player.first_name, lastName: player.last_name, phone: player.phone, is_active: player.is_active, jersey_purchased: player.jersey_purchased })
  }

  function closeModal() {
    if (saving) return
    setEditModal(null)
  }

  async function toggleActive(player: Player) {
    const next = !player.is_active
    const { error } = await players.update(player.id, { is_active: next })
    if (error) { showToast(error.message, 'error'); return }
    showToast(`${player.name} marked ${next ? 'active' : 'inactive'}`, 'success')
    reload()
  }

  async function save() {
    if (!editModal) return
    const firstName = editModal.firstName.trim()
    const lastName = editModal.lastName.trim()
    const phone = (editModal.phone ?? '').trim()
    if (!firstName || !lastName || !phone) return
    const displayName = `${firstName} ${lastName}`
    setSaving(true)
    try {
      if (editModal.id) {
        const { error } = await players.update(editModal.id, {
          first_name: firstName,
          last_name: lastName,
          phone: normalizePhone(editModal.phone),
          is_active: editModal.is_active,
          jersey_purchased: editModal.jersey_purchased,
        })
        if (error) { showToast(error.message, 'error'); return }
        showToast(`Updated ${displayName}`, 'success')
      } else {
        const { error } = await players.insert({
          id: crypto.randomUUID(),
          first_name: firstName,
          last_name: lastName,
          phone: normalizePhone(editModal.phone),
          is_active: editModal.is_active,
          jersey_purchased: editModal.jersey_purchased,
        })
        if (error) { showToast(error.message, 'error'); return }
        showToast(`Added ${displayName}`, 'success')
      }
      setEditModal(null)
      reload()
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Player Management" onBack={() => navigation.goBack()} />

      {loading ? (
        <LoadingView label="Loading players…" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 88 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        >
          <Text style={styles.sectionHeader}>ACTIVE ({active.length})</Text>
          {active.map(p => (
            <PlayerRow key={p.id} player={p} onEdit={() => openEdit(p)} onToggle={() => toggleActive(p)} />
          ))}
          {active.length === 0 && <Text style={styles.emptyText}>No active players</Text>}

          <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>INACTIVE ({inactive.length})</Text>
          {inactive.map(p => (
            <PlayerRow key={p.id} player={p} onEdit={() => openEdit(p)} onToggle={() => toggleActive(p)} />
          ))}
          {inactive.length === 0 && <Text style={styles.emptyText}>No inactive players</Text>}
        </ScrollView>
      )}

      <View style={[styles.addBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>+ Add Player</Text>
        </TouchableOpacity>
      </View>

      {editModal !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={closeModal}>
          <KeyboardAvoidingView
            style={styles.modalWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeModal}>
              <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
                <Text style={styles.sheetTitle}>
                  {editModal.id ? 'Edit Player' : 'Add Player'}
                </Text>

                <Text style={styles.fieldLabel}>FIRST NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First name"
                  placeholderTextColor={colors.muted}
                  value={editModal.firstName}
                  onChangeText={v => setEditModal(prev => prev ? { ...prev, firstName: v } : null)}
                  autoFocus
                  returnKeyType="next"
                />

                <Text style={styles.fieldLabel}>LAST NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Last name"
                  placeholderTextColor={colors.muted}
                  value={editModal.lastName}
                  onChangeText={v => setEditModal(prev => prev ? { ...prev, lastName: v } : null)}
                  returnKeyType="next"
                />

                <Text style={styles.fieldLabel}>PHONE</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Phone number"
                  placeholderTextColor={colors.muted}
                  value={editModal.phone ?? ''}
                  onChangeText={v => setEditModal(prev => prev ? { ...prev, phone: v || null } : null)}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={save}
                />

                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>ACTIVE</Text>
                  <TouchableOpacity
                    style={[styles.togglePill, editModal.is_active && styles.togglePillOn]}
                    onPress={() => setEditModal(prev => prev ? { ...prev, is_active: !prev.is_active } : null)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.togglePillText, editModal.is_active && styles.togglePillTextOn]}>
                      {editModal.is_active ? 'Yes' : 'No'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>JERSEY PURCHASED</Text>
                  <TouchableOpacity
                    style={[styles.togglePill, editModal.jersey_purchased && styles.togglePillOn]}
                    onPress={() => setEditModal(prev => prev ? { ...prev, jersey_purchased: !prev.jersey_purchased } : null)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.togglePillText, editModal.jersey_purchased && styles.togglePillTextOn]}>
                      {editModal.jersey_purchased ? 'Yes' : 'No'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.btnCancel}
                    onPress={closeModal}
                    disabled={saving}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnPrimary, (!editModal.firstName.trim() || !editModal.lastName.trim() || !(editModal.phone ?? '').trim() || saving) && styles.btnDisabled]}
                    onPress={save}
                    disabled={!editModal.firstName.trim() || !editModal.lastName.trim() || !(editModal.phone ?? '').trim() || saving}
                    activeOpacity={0.7}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={colors.bg} />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </KeyboardAvoidingView>
          {/* Rendered inside the Modal so toasts aren't occluded by the native modal layer. */}
          <Toast />
        </Modal>
      )}
    </SafeAreaView>
  )
}

function PlayerRow({
  player,
  onEdit,
  onToggle,
}: {
  player: Player
  onEdit: () => void
  onToggle: () => void
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>
          {player.name}
          {player.jersey_purchased ? <Text style={styles.jerseyMark}>  🎽</Text> : null}
        </Text>
        {player.phone ? <Text style={styles.rowPhone}>{player.phone}</Text> : null}
      </View>
      <TouchableOpacity
        style={[styles.statusPill, player.is_active ? styles.pillActive : styles.pillInactive]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <Text style={[styles.pillText, player.is_active ? styles.pillTextActive : styles.pillTextInactive]}>
          {player.is_active ? 'Active' : 'Inactive'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.editBtn} onPress={onEdit} activeOpacity={0.7}>
        <Text style={styles.editBtnText}>Edit</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  sectionHeaderSpaced: { marginTop: 24 },

  emptyText: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  rowInfo: { flex: 1 },
  rowName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 17,
    color: colors.text,
    letterSpacing: 0.3,
  },
  rowPhone: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  jerseyMark: { fontSize: 13 },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderColor: colors.success,
  },
  pillInactive: {
    backgroundColor: 'transparent',
    borderColor: colors.muted2,
  },
  pillText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  pillTextActive: { color: colors.success },
  pillTextInactive: { color: colors.muted2 },

  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  editBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  addBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // modal
  modalWrap: { flex: 1 },
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
  },
  sheetTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  togglePill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.muted2,
  },
  togglePillOn: {
    backgroundColor: 'rgba(232,255,71,0.12)',
    borderColor: colors.accent,
  },
  togglePillText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  togglePillTextOn: { color: colors.accent },

  btnRow: { flexDirection: 'row', gap: 10 },
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
  btnDisabled: { opacity: 0.4 },
})
