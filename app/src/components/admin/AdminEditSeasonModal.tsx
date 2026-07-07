import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useUiStore } from '../../stores/uiStore'
import { seasons } from '../../utils/supabase/db'
import { SeasonOption } from '../../hooks/useRegistrationData'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useDatePicker } from '../../hooks/useDatePicker'
import { toISO, fromISO, formatDateLong } from '../../utils/helpers'

interface Props {
  // Mount conditionally (`{editSeason && <… />}`) so the form resets per season.
  season: SeasonOption
  onClose: () => void
  onSaved?: () => void | Promise<void>
}

export default function AdminEditSeasonModal({ season, onClose, onSaved }: Props) {
  const [bowlingNight, setBowlingNight] = useState(season.bowling_night ?? '')
  // One picker instance per date; the toggle buttons close the other so at most
  // one picker is showing. `endSet` keeps the "Select end date" placeholder for
  // seasons without an end date until the admin actually picks one.
  const startPicker = useDatePicker(() => fromISO(season.start_date) ?? new Date())
  const endPicker = useDatePicker(() => fromISO(season.end_date) ?? fromISO(season.start_date) ?? new Date())
  const [endSet, setEndSet] = useState(fromISO(season.end_date) != null)
  const [saving, setSaving] = useState(false)
  const { showToast } = useUiStore()

  const startDate = startPicker.value
  const endDate = endSet ? endPicker.value : null

  function onEndChange(e: unknown, selected?: Date) {
    endPicker.onChange(e, selected)
    if (selected) setEndSet(true)
  }

  async function submit() {
    if (saving) return
    if (!bowlingNight.trim()) {
      showToast('Bowling night is required', 'error')
      return
    }
    if (!endDate) {
      showToast('End date is required', 'error')
      return
    }
    if (endDate <= startDate) {
      showToast('End date must be after start date', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await seasons.update(season.id, {
        bowling_night: bowlingNight.trim(),
        start_date: toISO(startDate),
        end_date: toISO(endDate),
      })
      if (error) { showToast(error.message, 'error'); setSaving(false); return }
      showToast(`Season ${season.number} updated`, 'success')
      await onSaved?.()
      onClose()
    } catch {
      showToast('Failed to update season', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={`Edit Season ${season.number}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label="Save Changes"
            size="lg"
            onPress={submit}
            loading={saving}
            disabled={saving}
            style={styles.confirmBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <Text style={styles.fieldLabel}>BOWLING NIGHT</Text>
      <TextInput
        style={styles.input}
        value={bowlingNight}
        onChangeText={setBowlingNight}
        placeholder="e.g. Monday"
        placeholderTextColor={colors.muted2}
      />

      <Text style={styles.fieldLabel}>START DATE</Text>
      <TouchableOpacity
        style={[styles.dateBtn, startPicker.open && styles.dateBtnActive]}
        onPress={() => { endPicker.setOpen(false); startPicker.setOpen(o => !o) }}
        activeOpacity={0.8}
      >
        <Text style={styles.dateBtnText}>{formatDateLong(startDate)}</Text>
        <Text style={styles.dateBtnChevron}>›</Text>
      </TouchableOpacity>
      {startPicker.open && (
        <DateTimePicker
          value={startDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={startPicker.onChange}
          style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
          themeVariant="dark"
        />
      )}

      <Text style={[styles.fieldLabel, { marginTop: 4 }]}>END DATE</Text>
      <TouchableOpacity
        style={[styles.dateBtn, endPicker.open && styles.dateBtnActive]}
        onPress={() => { startPicker.setOpen(false); endPicker.setOpen(o => !o) }}
        activeOpacity={0.8}
      >
        <Text style={[styles.dateBtnText, !endDate && styles.dateBtnPlaceholder]}>
          {endDate ? formatDateLong(endDate) : 'Select end date'}
        </Text>
        <Text style={styles.dateBtnChevron}>›</Text>
      </TouchableOpacity>
      {endPicker.open && (
        <DateTimePicker
          value={endDate ?? startDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={startDate}
          onChange={onEndChange}
          style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
          themeVariant="dark"
        />
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    marginBottom: 8,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 4,
  },
  dateBtnActive: { borderColor: colors.accent },
  dateBtnText: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  dateBtnPlaceholder: { color: colors.muted2 },
  dateBtnChevron: { fontFamily: fonts.barlow, fontSize: 18, color: colors.muted, marginTop: -1 },
  iosPicker: { marginBottom: 8 },
  confirmBtn: { marginTop: 18 },
})
