import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { seasons, weeks, pinLedger, bountyPosts } from '../utils/supabase/db'
import {
  MIN_SPONSOR_BOUNTY, MIN_HUNTER_STAKE, MAX_TITLE_LEN, MAX_DESCRIPTION_LEN,
  protectedProfit, defaultBountyCloseAt, formatCloseTime,
} from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

export default function BountyCreateScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [weekId, setWeekId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sponsorAmount, setSponsorAmount] = useState('')
  const [hunterStake, setHunterStake] = useState('')
  const [closesAt, setClosesAt] = useState<Date>(() => defaultBountyCloseAt())
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [seasonRes, weekRes] = await Promise.all([seasons.getCurrent(), weeks.getCurrent()])
      const seasonId = seasonRes.data?.id ?? null
      setWeekId(weekRes.data?.id ?? null)
      if (seasonId && playerId) {
        const { data } = await pinLedger.listByPlayerSeason(playerId, seasonId)
        setBalance(((data ?? []) as any[]).reduce((sum, e) => sum + e.amount, 0))
      }
    } catch (e) {
      console.error('BountyCreate load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [playerId])
  const { refreshing, onRefresh } = useRefresh(load)

  const S = Number(sponsorAmount) || 0
  const H = Number(hunterStake) || 0

  const error = useMemo<string | null>(() => {
    if (!title.trim()) return 'Add a title'
    if (title.length > MAX_TITLE_LEN) return `Title must be ≤ ${MAX_TITLE_LEN} characters`
    if (!description.trim()) return 'Add a description'
    if (description.length > MAX_DESCRIPTION_LEN) return `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`
    if (S < MIN_SPONSOR_BOUNTY) return `Sponsor bounty must be at least ${MIN_SPONSOR_BOUNTY}`
    if (H < MIN_HUNTER_STAKE) return `Hunter stake must be at least ${MIN_HUNTER_STAKE}`
    if (S > balance) return 'Sponsor bounty exceeds your balance'
    if (closesAt.getTime() <= Date.now()) return 'Close time must be in the future'
    return null
  }, [title, description, S, H, balance, closesAt])

  async function submit() {
    if (submitting || error) return
    if (!weekId) { showToast('No active week to attach the bounty to', 'error'); return }
    setSubmitting(true)
    try {
      const { data, error: rpcErr } = await bountyPosts.createSponsor({
        weekId,
        title: title.trim(),
        description: description.trim(),
        sponsorBountyAmount: S,
        hunterStakeAmount: H,
        closesAt: closesAt.toISOString(),
      })
      if (rpcErr) { showToast(rpcErr.message, 'error'); return }
      showToast('Bounty posted', 'success')
      const newId = data as unknown as string
      if (newId) navigation.replace('BountyDetail', { bountyId: newId })
      else navigation.goBack()
    } catch {
      showToast('Failed to post bounty', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function onPickerValue(_e: unknown, selected?: Date) {
    if (Platform.OS === 'android') setPickerOpen(false)
    if (selected) setClosesAt(selected)
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Post a Bounty" subtitle="Risk pins, draw the hunters" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.balancePill}>
          <Text style={styles.balancePillLabel}>YOUR BALANCE</Text>
          <Text style={styles.balancePillValue}>{balance.toLocaleString()} pins</Text>
        </View>

        <Text style={styles.label}>TITLE</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Beat my 200 game"
          placeholderTextColor={colors.muted2}
          maxLength={MAX_TITLE_LEN}
        />

        <Text style={styles.label}>DESCRIPTION</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe exactly how the bounty is won. An admin settles based on this."
          placeholderTextColor={colors.muted2}
          multiline
          maxLength={MAX_DESCRIPTION_LEN}
        />

        <View style={styles.row}>
          <View style={styles.rowCol}>
            <Text style={styles.label}>SPONSOR BOUNTY</Text>
            <TextInput
              style={styles.input}
              value={sponsorAmount}
              onChangeText={t => setSponsorAmount(t.replace(/[^0-9]/g, ''))}
              placeholder={`min ${MIN_SPONSOR_BOUNTY}`}
              placeholderTextColor={colors.muted2}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.rowCol}>
            <Text style={styles.label}>HUNTER STAKE</Text>
            <TextInput
              style={styles.input}
              value={hunterStake}
              onChangeText={t => setHunterStake(t.replace(/[^0-9]/g, ''))}
              placeholder={`min ${MIN_HUNTER_STAKE}`}
              placeholderTextColor={colors.muted2}
              keyboardType="number-pad"
            />
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

        {/* Live anti-dilution preview (design §29.4) */}
        {S >= MIN_SPONSOR_BOUNTY && (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>HOW IT PAYS OUT</Text>
            <Text style={styles.previewLine}>You are risking {S.toLocaleString()} pins. Hunters stake {H.toLocaleString()} pins each.</Text>
            <Text style={styles.previewLine}>Hunter #1 profit if hunters win: +{protectedProfit(S, 1).toLocaleString()}</Text>
            <Text style={styles.previewLine}>Hunter #2: +{protectedProfit(S, 2).toLocaleString()}</Text>
            <Text style={styles.previewLine}>Hunter #3: +{protectedProfit(S, 3).toLocaleString()}</Text>
            <Text style={styles.previewLine}>More hunters get progressively lower protected profit. The Pinsino seeds the pot if needed to protect early hunters.</Text>
            <Text style={styles.disclaimer}>This does not affect bowling gameplay.</Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.submitBtn, (error || submitting) && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={!!error || submitting}
          activeOpacity={0.7}
        >
          <Text style={styles.submitText}>{submitting ? 'Posting…' : 'Post Bounty'}</Text>
        </TouchableOpacity>
      </ScrollView>
      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balancePill: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.cardMd, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 16, paddingVertical: 12, marginTop: 8, marginBottom: 12,
  },
  balancePillLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted },
  balancePillValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },

  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  rowCol: { flex: 1 },

  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  dateBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  dateBtnChevron: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.muted },

  previewCard: {
    backgroundColor: colors.accentDim, borderRadius: radius.cardMd, borderWidth: 1, borderColor: colors.border2,
    padding: 14, marginTop: 18,
  },
  previewTitle: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.accent, marginBottom: 8 },
  previewLine: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text, lineHeight: 20 },
  disclaimer: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, marginTop: 10, letterSpacing: 0.3 },

  errorText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.danger, marginTop: 14 },

  submitBtn: { backgroundColor: colors.accent, borderRadius: radius.cardSm, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.barlowCondensed, fontSize: 16, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
})
