import { useState, useEffect } from 'react'
import { Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useUiStore } from '../../stores/uiStore'
import { seasons, seasonChampions, pinLedger } from '../../utils/supabase/db'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useDatePicker } from '../../hooks/useDatePicker'
import { toISO, formatDateLong } from '../../utils/helpers'

interface Props {
  // Mount conditionally so the form resets between opens.
  onClose: () => void
  onCreated?: () => void | Promise<void>
}

export default function AdminOpenRegistrationModal({ onClose, onCreated }: Props) {
  const [nextNumber, setNextNumber] = useState<number | null>(null)
  const [bowlingNight, setBowlingNight] = useState('')
  // One picker instance per date; the toggle buttons close the other so at most
  // one picker is showing. `endSet` keeps the "Select end date" placeholder
  // until the admin actually picks one — the end date is required.
  const startPicker = useDatePicker(() => new Date())
  const endPicker = useDatePicker(() => new Date())
  const [endSet, setEndSet] = useState(false)
  const [saving, setSaving] = useState(false)
  const { showToast } = useUiStore()

  useEffect(() => {
    seasons.getLatest().then(({ data }) => {
      setNextNumber((data?.number ?? 0) + 1)
      setBowlingNight(data?.bowling_night ?? '')
    })
  }, [])

  const startDate = startPicker.value
  const endDate = endSet ? endPicker.value : null

  function onEndChange(e: unknown, selected?: Date) {
    endPicker.onChange(e, selected)
    if (selected) setEndSet(true)
  }

  async function submit() {
    if (saving) return
    if (nextNumber == null) {
      showToast('Still loading season info — try again', 'error')
      return
    }
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
      const { error } = await seasons.insert({
        number: nextNumber,
        bowling_night: bowlingNight.trim(),
        start_date: toISO(startDate),
        end_date: toISO(endDate),
        registration_open: true,
        is_active: false,
      })
      if (error) { showToast(error.message, 'error'); setSaving(false); return }

      // Credit +100 pin bonus to prior-season champions for the new season.
      const [newSeasonRes, lastEndedRes] = await Promise.all([
        seasons.getLatest(),
        seasons.getLastEnded(),
      ])
      if (newSeasonRes.data && lastEndedRes.data) {
        const { data: champions } = await seasonChampions.listBySeason(lastEndedRes.data.id)
        if (champions && champions.length > 0) {
          const seasonId = newSeasonRes.data!.id
          const desc = `Season ${lastEndedRes.data!.number} champion bonus`
          // Bonuses are house-funded: each +100 player credit is paired with a
          // -100 house debit so the bonus nets to zero across the economy.
          await pinLedger.insert(
            champions.flatMap(c => [
              {
                player_id: c.player_id,
                season_id: seasonId,
                amount: 100,
                type: 'bonus' as const,
                description: desc,
              },
              {
                player_id: null,
                season_id: seasonId,
                is_house: true,
                amount: -100,
                type: 'bonus' as const,
                description: `House-funded: ${desc}`,
              },
            ])
          )
        }
      }

      showToast(`Registration open for Season ${nextNumber}`, 'success')
      await onCreated?.()
      onClose()
    } catch {
      showToast('Failed to open registration', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={`Open Registration — Season ${nextNumber ?? '…'}`}
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label="Open Registration"
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
      <Text style={styles.body}>
        Creates the next season and opens its registration window so players can sign up.
        Weeks and teams are set up later once registration closes.
      </Text>

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
  body: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 8,
  },
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
