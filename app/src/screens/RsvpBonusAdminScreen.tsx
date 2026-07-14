import { useState, useCallback, useEffect } from 'react'
import { View, Text, StyleSheet, TextInput, Switch, TouchableOpacity, Platform } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import Toast from '../components/ui/Toast'
import EmptyCard from '../components/ui/EmptyCard'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import {
  rsvpBonusConfig as dbRsvpBonusConfig,
  weeks as dbWeeks,
} from '../utils/supabase/db'
import { toISO, fromISO, formatDateLong, comingMonday } from '../utils/helpers'
import type { Tables } from '../utils/supabase/database.types'

type RsvpBonusConfig = Tables<'rsvp_bonus_config'>

// Admin editor for the RSVP feature: the active week's official game night
// (weeks.bowled_at) and the global self-submit bonus config (season_id NULL).
// The server (submit_own_rsvp) is authoritative for the bonus; this only edits
// config + the week's bowl date. The bonus deadline is anchored to bowled_at.
export default function RsvpBonusAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const myPlayerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<RsvpBonusConfig | null>(null)

  // Active week + its game night (bowled_at, a 'YYYY-MM-DD' date).
  const [weekId, setWeekId] = useState<string | null>(null)
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [bowledAt, setBowledAt] = useState<string | null>(null)
  const [origBowledAt, setOrigBowledAt] = useState<string | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Bonus config fields (strings for the text inputs).
  const [enabled, setEnabled] = useState(true)
  const [amount, setAmount] = useState('50')
  const [time, setTime] = useState('18:00')
  const [timezone, setTimezone] = useState('America/New_York')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, weekRes] = await Promise.all([
        dbRsvpBonusConfig.getGlobal(),
        dbWeeks.getCurrent(),
      ])
      if (cfgRes.data) {
        setConfig(cfgRes.data)
        setEnabled(cfgRes.data.is_enabled)
        setAmount(String(cfgRes.data.bonus_amount))
        setTime(cfgRes.data.deadline_time.slice(0, 5)) // 'HH:MM:SS' → 'HH:MM'
        setTimezone(cfgRes.data.timezone)
      }
      if (weekRes.data) {
        setWeekId(weekRes.data.id)
        setWeekNumber(weekRes.data.week_number)
        setBowledAt(weekRes.data.bowled_at)
        setOrigBowledAt(weekRes.data.bowled_at)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The date picker's value: the current game night, or the coming Monday if unset.
  const bowledDate = fromISO(bowledAt) ?? comingMonday()

  function onDateChange(_e: unknown, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false)
    if (selected) setBowledAt(toISO(selected))
  }

  async function saveGameNight() {
    if (!weekId || bowledAt === origBowledAt) return
    setSaving(true)
    try {
      const { error } = await dbWeeks.update(weekId, { bowled_at: bowledAt })
      if (error) { showToast(error.message, 'error'); return }
      setOrigBowledAt(bowledAt)
      showToast('Game night saved', 'success')
    } finally {
      setSaving(false)
    }
  }

  async function saveBonus() {
    if (!config) return
    const amt = parseInt(amount, 10)
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Amount must be a positive number', 'error'); return
    }
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time.trim())) {
      showToast('Time must be HH:MM (24-hour)', 'error'); return
    }
    if (!timezone.trim()) {
      showToast('Timezone is required', 'error'); return
    }
    setSaving(true)
    try {
      const { error } = await dbRsvpBonusConfig.update(config.id, {
        is_enabled: enabled,
        bonus_amount: amt,
        deadline_time: `${time.trim()}:00`,
        timezone: timezone.trim(),
        updated_by: myPlayerId,
      })
      if (error) { showToast(error.message, 'error'); return }
      showToast('Bonus saved', 'success')
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <ScreenContainer title="RSVP" loading={loading} scroll={false}>
        <EmptyCard text="Admins only" style={{ marginHorizontal: 16 }} />
      </ScreenContainer>
    )
  }

  const gameNightDirty = bowledAt !== origBowledAt

  return (
    <ScreenContainer
      title="RSVP"
      subtitle="Game night & self-submit bonus"
      loading={loading}
      overlay={<Toast />}
    >
      {/* ── Game night (active week's bowled_at) ─────────────────────────── */}
      <Text style={styles.sectionHeader}>
        GAME NIGHT{weekNumber != null ? ` · WEEK ${weekNumber}` : ''}
      </Text>
      {weekId ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.label}>Official game night</Text>
              <Text style={styles.hint}>The RSVP bonus deadline is anchored to this date</Text>
            </View>
            <TouchableOpacity
              style={[styles.dateBtn, showDatePicker && styles.dateBtnActive]}
              onPress={() => setShowDatePicker(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.dateBtnText}>{formatDateLong(bowledDate)}</Text>
            </TouchableOpacity>
          </View>
          {showDatePicker && (
            <DateTimePicker
              value={bowledDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onDateChange}
              themeVariant="dark"
            />
          )}
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => setBowledAt(toISO(comingMonday()))}
            activeOpacity={0.7}
          >
            <Text style={styles.linkBtnText}>Set to this coming Monday</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <EmptyCard text="No active week" style={{ marginHorizontal: 16 }} />
      )}
      {gameNightDirty && (
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={saveGameNight}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save game night'}</Text>
        </TouchableOpacity>
      )}

      {/* ── Self-submit bonus config ─────────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { marginTop: 24 }]}>SELF-SUBMIT BONUS</Text>
      <View style={styles.card}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowLeft}>
            <Text style={styles.label}>Bonus enabled</Text>
            <Text style={styles.hint}>Pay the bonus for a personal RSVP</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: colors.success, false: colors.surface3 }}
          />
        </View>

        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowLeft}>
            <Text style={styles.label}>Bonus amount</Text>
            <Text style={styles.hint}>Pins paid per player, once per week</Text>
          </View>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder="50"
            placeholderTextColor={colors.muted}
          />
        </View>

        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowLeft}>
            <Text style={styles.label}>Deadline time</Text>
            <Text style={styles.hint}>24-hour, on the game night (HH:MM)</Text>
          </View>
          <TextInput
            style={styles.input}
            value={time}
            onChangeText={setTime}
            placeholder="18:00"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Text style={styles.label}>Timezone</Text>
            <Text style={styles.hint}>IANA name the deadline is evaluated in</Text>
          </View>
          <TextInput
            style={[styles.input, styles.inputWide]}
            value={timezone}
            onChangeText={setTimezone}
            placeholder="America/New_York"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={saveBonus}
        disabled={saving}
        activeOpacity={0.8}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save bonus'}</Text>
      </TouchableOpacity>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLeft: { flex: 1 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  hint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 1 },
  input: {
    minWidth: 80,
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
  },
  inputWide: { minWidth: 160, textAlign: 'left' },
  dateBtn: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dateBtnActive: { borderColor: colors.accent },
  dateBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  linkBtn: { paddingHorizontal: 14, paddingBottom: 12 },
  linkBtnText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.accent },
  saveBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: '#0a0a0c',
    letterSpacing: 0.5,
  },
})
