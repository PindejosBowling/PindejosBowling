import { useState, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useUiStore } from '../stores/uiStore'
import { seasons, seasonChampions, pinLedger } from '../utils/supabase/db'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'

interface Props {
  visible: boolean
  onClose: () => void
  onCreated?: () => void | Promise<void>
}

function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDisplay(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// On Android the native dialog is always modal, so we show it imperatively.
// On iOS we inline a spinner directly in the sheet.
type ActivePicker = 'start' | 'end' | null

export default function AdminOpenRegistrationModal({ visible, onClose, onCreated }: Props) {
  const [nextNumber, setNextNumber] = useState<number | null>(null)
  const [bowlingNight, setBowlingNight] = useState('')
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [activePicker, setActivePicker] = useState<ActivePicker>(null)
  const [saving, setSaving] = useState(false)
  const { showToast } = useUiStore()

  useEffect(() => {
    if (!visible) return
    seasons.getLatest().then(({ data }) => {
      setNextNumber((data?.number ?? 0) + 1)
      setBowlingNight(data?.bowling_night ?? '')
      setStartDate(new Date())
      setEndDate(null)
      setActivePicker(null)
    })
  }, [visible])

  function onPickerValue(field: 'start' | 'end') {
    return (_event: unknown, selected?: Date) => {
      if (Platform.OS === 'android') setActivePicker(null)
      if (!selected) return
      if (field === 'start') setStartDate(selected)
      else setEndDate(selected)
    }
  }

  function onPickerDismiss() {
    if (Platform.OS === 'android') setActivePicker(null)
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

  function handleClose() {
    if (saving) return
    setActivePicker(null)
    onClose()
  }

  const showInlinePicker = Platform.OS === 'ios'

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Open Registration — Season {nextNumber ?? '…'}</Text>
          <Text style={styles.subtitle}>
            Creates the next season and opens its registration window so players can sign up.
            Weeks and teams are set up later once registration closes.
          </Text>

          <Text style={styles.fieldLabel}>Bowling night</Text>
          <TextInput
            style={styles.input}
            value={bowlingNight}
            onChangeText={setBowlingNight}
            placeholder="e.g. Monday"
            placeholderTextColor={colors.muted2}
          />

          {/* Start date */}
          <Text style={styles.fieldLabel}>Start date</Text>
          <TouchableOpacity
            style={[styles.dateBtn, activePicker === 'start' && styles.dateBtnActive]}
            onPress={() => setActivePicker(activePicker === 'start' ? null : 'start')}
            activeOpacity={0.8}
          >
            <Text style={styles.dateBtnText}>{formatDisplay(startDate)}</Text>
            <Text style={styles.dateBtnChevron}>›</Text>
          </TouchableOpacity>
          {(showInlinePicker ? activePicker === 'start' : activePicker === 'start') && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onValueChange={onPickerValue('start')}
              onDismiss={onPickerDismiss}
              style={showInlinePicker ? styles.iosPicker : undefined}
              themeVariant="dark"
            />
          )}

          {/* End date */}
          <Text style={[styles.fieldLabel, { marginTop: 4 }]}>End date</Text>
          <TouchableOpacity
            style={[styles.dateBtn, activePicker === 'end' && styles.dateBtnActive, !endDate && styles.dateBtnEmpty]}
            onPress={() => setActivePicker(activePicker === 'end' ? null : 'end')}
            activeOpacity={0.8}
          >
            <Text style={[styles.dateBtnText, !endDate && styles.dateBtnPlaceholder]}>
              {endDate ? formatDisplay(endDate) : 'Select end date'}
            </Text>
            <Text style={styles.dateBtnChevron}>›</Text>
          </TouchableOpacity>
          {(activePicker === 'end') && (
            <DateTimePicker
              value={endDate ?? startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={startDate}
              onValueChange={onPickerValue('end')}
              onDismiss={onPickerDismiss}
              style={showInlinePicker ? styles.iosPicker : undefined}
              themeVariant="dark"
            />
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btnCancel} onPress={handleClose} disabled={saving} activeOpacity={0.7}>
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={submit}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>Open Registration</Text>
              )}
            </TouchableOpacity>
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
    maxHeight: '92%',
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
    marginBottom: 16,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    marginBottom: 14,
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
  dateBtnEmpty: { borderColor: colors.border2 },
  dateBtnText: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  dateBtnPlaceholder: { color: colors.muted2 },
  dateBtnChevron: { fontFamily: fonts.barlow, fontSize: 18, color: colors.muted, marginTop: -1 },
  iosPicker: { marginBottom: 8, tintColor: colors.accent },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
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
