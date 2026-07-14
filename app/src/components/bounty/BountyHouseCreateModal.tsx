import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PinAmountInput from '../ui/PinAmountInput'
import { useUiStore } from '../../stores/uiStore'
import { useDatePicker } from '../../hooks/useDatePicker'
import { bountyPosts, players, seasons } from '../../utils/supabase/db'
import {
  MIN_REWARD_PER_HUNTER, MIN_HUNTER_STAKE, MIN_MAX_HUNTERS, MAX_MAX_HUNTERS,
  MAX_TITLE_LEN, MAX_DESCRIPTION_LEN, defaultBountyCloseAt, formatCloseTime,
} from '../../utils/bounty'

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
  const [reward, setReward] = useState('')
  const [hunterStake, setHunterStake] = useState('')
  const [maxHunters, setMaxHunters] = useState('')
  const { value: closesAt, open: pickerOpen, setOpen: setPickerOpen, onChange: onPickerValue } = useDatePicker(defaultBountyCloseAt)
  const [saving, setSaving] = useState(false)

  // Default Max Hunters to the number of players registered for the current
  // season. Only seeds the field while it's still untouched/empty.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: season } = await seasons.getCurrent()
      if (cancelled || !season) return
      const { data } = await players.listBySeason(season.id)
      if (cancelled || !data) return
      const count = Math.min(data.length, MAX_MAX_HUNTERS)
      if (count >= MIN_MAX_HUNTERS) setMaxHunters(prev => (prev ? prev : String(count)))
    })()
    return () => { cancelled = true }
  }, [])

  const R = Number(reward) || 0
  const H = Number(hunterStake) || 0
  const m = Number(maxHunters) || 0

  const error = useMemo<string | null>(() => {
    if (!title.trim()) return 'Add a title'
    if (title.length > MAX_TITLE_LEN) return `Title must be ≤ ${MAX_TITLE_LEN} characters`
    if (!description.trim()) return 'Add a description'
    if (description.length > MAX_DESCRIPTION_LEN) return `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`
    if (R < MIN_REWARD_PER_HUNTER) return `Reward per hunter must be at least ${MIN_REWARD_PER_HUNTER}`
    if (H < MIN_HUNTER_STAKE) return `Hunter stake must be at least ${MIN_HUNTER_STAKE}`
    if (m < MIN_MAX_HUNTERS || m > MAX_MAX_HUNTERS) return `Max hunters must be between ${MIN_MAX_HUNTERS} and ${MAX_MAX_HUNTERS}`
    if (closesAt.getTime() <= Date.now()) return 'Close time must be in the future'
    return null
  }, [title, description, R, H, m, closesAt])

  async function submit() {
    if (saving || error) return
    if (!weekId) { showToast('No active week to attach the bounty to', 'error'); return }
    setSaving(true)
    try {
      const { error: rpcErr } = await bountyPosts.createHouse({
        weekId,
        title: title.trim(),
        description: description.trim(),
        rewardPerHunter: R,
        hunterStakeAmount: H,
        maxHunters: m,
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


  return (
    <BottomSheet
      title="New House Bounty"
      subtitle="Posted by the Pinsino · Let the Hunt Begin"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label="Post House Bounty"
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
          <Text style={styles.label}>HUNTER STAKE</Text>
          <PinAmountInput value={hunterStake} onChangeText={setHunterStake} placeholder={`min ${MIN_HUNTER_STAKE}`} />
        </View>
        <View style={styles.rowCol}>
          <Text style={styles.label}>REWARD / HUNTER</Text>
          <PinAmountInput value={reward} onChangeText={setReward} placeholder={`min ${MIN_REWARD_PER_HUNTER}`} />
        </View>
        <View style={styles.rowCol}>
          <Text style={styles.label}>MAX HUNTERS</Text>
          <PinAmountInput value={maxHunters} onChangeText={setMaxHunters} placeholder={`1–${MAX_MAX_HUNTERS}`} />
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
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
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
  submitBtn: { marginTop: 14 },
})
