import { useMemo, useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import { useUiStore } from '../stores/uiStore'
import { bountyPosts } from '../utils/supabase/db'
import {
  MIN_SPONSOR_BOUNTY, MIN_HUNTER_STAKE, MAX_TITLE_LEN, MAX_DESCRIPTION_LEN,
  defaultBountyCloseAt, formatCloseTime,
} from '../utils/bounty'

interface Props {
  // The House sponsors the bounty (no escrow at create; design §23.4). Mounted
  // conditionally so it resets between opens.
  weekId: string | null
  onClose: () => void
  onDone: () => void
}

export default function BountyHouseCreateModal({ weekId, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sponsorAmount, setSponsorAmount] = useState('')
  const [hunterStake, setHunterStake] = useState('')
  const [closesAt, setClosesAt] = useState<Date>(() => defaultBountyCloseAt())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const S = Number(sponsorAmount) || 0
  const H = Number(hunterStake) || 0

  const error = useMemo<string | null>(() => {
    if (!title.trim()) return 'Add a title'
    if (title.length > MAX_TITLE_LEN) return `Title must be ≤ ${MAX_TITLE_LEN} characters`
    if (!description.trim()) return 'Add a description'
    if (description.length > MAX_DESCRIPTION_LEN) return `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`
    if (S < MIN_SPONSOR_BOUNTY) return `Sponsor bounty must be at least ${MIN_SPONSOR_BOUNTY}`
    if (H < MIN_HUNTER_STAKE) return `Hunter stake must be at least ${MIN_HUNTER_STAKE}`
    if (closesAt.getTime() <= Date.now()) return 'Close time must be in the future'
    return null
  }, [title, description, S, H, closesAt])

  async function submit() {
    if (saving || error) return
    if (!weekId) { showToast('No active week to attach the bounty to', 'error'); return }
    setSaving(true)
    try {
      const { error: rpcErr } = await bountyPosts.createHouse({
        weekId,
        title: title.trim(),
        description: description.trim(),
        sponsorBountyAmount: S,
        hunterStakeAmount: H,
        closesAt: closesAt.toISOString(),
      })
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast('House bounty posted', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to post bounty', 'error')
    } finally {
      setSaving(false)
    }
  }

  function onPickerValue(_e: unknown, selected?: Date) {
    if (Platform.OS === 'android') setPickerOpen(false)
    if (selected) setClosesAt(selected)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <Text style={styles.title}>New House Bounty</Text>
          <Text style={styles.subtitle}>Posted by the Pinsino · no escrow until hunters win</Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>TITLE</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.muted2} maxLength={MAX_TITLE_LEN} />

            <Text style={styles.label}>DESCRIPTION</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="How the bounty is won (admin-settled)."
              placeholderTextColor={colors.muted2}
              multiline
              maxLength={MAX_DESCRIPTION_LEN}
            />

            <View style={styles.row}>
              <View style={styles.rowCol}>
                <Text style={styles.label}>SPONSOR BOUNTY</Text>
                <TextInput style={styles.input} value={sponsorAmount} onChangeText={t => setSponsorAmount(t.replace(/[^0-9]/g, ''))} placeholder={`min ${MIN_SPONSOR_BOUNTY}`} placeholderTextColor={colors.muted2} keyboardType="number-pad" />
              </View>
              <View style={styles.rowCol}>
                <Text style={styles.label}>HUNTER STAKE</Text>
                <TextInput style={styles.input} value={hunterStake} onChangeText={t => setHunterStake(t.replace(/[^0-9]/g, ''))} placeholder={`min ${MIN_HUNTER_STAKE}`} placeholderTextColor={colors.muted2} keyboardType="number-pad" />
              </View>
            </View>

            <Text style={styles.label}>CLOSE TIME</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerOpen(o => !o)} activeOpacity={0.8}>
              <Text style={styles.dateBtnText}>{formatCloseTime(closesAt.toISOString())}</Text>
              <Text style={styles.dateBtnChevron}>›</Text>
            </TouchableOpacity>
            {pickerOpen && (
              <DateTimePicker
                value={closesAt}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date()}
                onChange={onPickerValue}
                themeVariant="dark"
              />
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          <TouchableOpacity
            style={[styles.submitBtn, (error || saving) && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={!!error || saving}
            activeOpacity={0.7}
          >
            {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Text style={styles.submitText}>Post House Bounty</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => !saving && onClose()} activeOpacity={0.7}>
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: colors.border, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  title: { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  subtitle: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.3, marginTop: 2, marginBottom: 8 },
  body: { maxHeight: 440 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 12, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  rowCol: { flex: 1 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  dateBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  dateBtnChevron: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.muted },
  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 12 },
  submitBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
  close: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 14 },
})
