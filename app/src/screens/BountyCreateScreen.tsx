import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, Platform,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import Toast from '../components/ui/Toast'
import Button from '../components/ui/Button'
import BalancePill from '../components/ui/BalancePill'
import PinAmountInput from '../components/ui/PinAmountInput'
import { useDatePicker } from '../hooks/useDatePicker'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { seasons, weeks, pinLedger, bountyPosts } from '../utils/supabase/db'
import {
  MIN_REWARD_PER_HUNTER, MIN_HUNTER_STAKE, MIN_MAX_HUNTERS, MAX_MAX_HUNTERS,
  MAX_TITLE_LEN, MAX_DESCRIPTION_LEN,
  sponsorMaxLiability, defaultBountyCloseAt, formatCloseTime,
} from '../utils/bounty'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

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
  const [reward, setReward] = useState('')
  const [hunterStake, setHunterStake] = useState('')
  const [maxHunters, setMaxHunters] = useState('')
  const { value: closesAt, open: pickerOpen, setOpen: setPickerOpen, onChange: onPickerValue } = useDatePicker(defaultBountyCloseAt)

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

  const R = Number(reward) || 0
  const H = Number(hunterStake) || 0
  const m = Number(maxHunters) || 0
  const escrow = sponsorMaxLiability(R, m)

  const error = useMemo<string | null>(() => {
    if (!title.trim()) return 'Add a title'
    if (title.length > MAX_TITLE_LEN) return `Title must be ≤ ${MAX_TITLE_LEN} characters`
    if (!description.trim()) return 'Add a description'
    if (description.length > MAX_DESCRIPTION_LEN) return `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`
    if (R < MIN_REWARD_PER_HUNTER) return `Reward per hunter must be at least ${MIN_REWARD_PER_HUNTER}`
    if (H < MIN_HUNTER_STAKE) return `Hunter stake must be at least ${MIN_HUNTER_STAKE}`
    if (m < MIN_MAX_HUNTERS || m > MAX_MAX_HUNTERS) return `Max hunters must be between ${MIN_MAX_HUNTERS} and ${MAX_MAX_HUNTERS}`
    if (escrow > balance) return `You'd escrow ${formatPins(escrow)} pins — more than your balance`
    if (closesAt.getTime() <= Date.now()) return 'Close time must be in the future'
    return null
  }, [title, description, R, H, m, escrow, balance, closesAt])

  async function submit() {
    if (submitting || error) return
    if (!weekId) { showToast('No active week to attach the bounty to', 'error'); return }
    setSubmitting(true)
    try {
      const { data, error: rpcErr } = await bountyPosts.createSponsor({
        weekId,
        title: title.trim(),
        description: description.trim(),
        rewardPerHunter: R,
        hunterStakeAmount: H,
        maxHunters: m,
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


  return (
    <ScreenContainer
      title="Post a Bounty"
      subtitle="Risk pins, draw the hunters"
      loading={loading}
      keyboardShouldPersistTaps="handled"
      overlay={<Toast />}
    >
        <BalancePill balance={balance} label="YOUR BALANCE" />

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
            <Text style={styles.label}>REWARD / HUNTER</Text>
            <PinAmountInput value={reward} onChangeText={setReward} placeholder={`min ${MIN_REWARD_PER_HUNTER}`} />
          </View>
          <View style={styles.rowCol}>
            <Text style={styles.label}>HUNTER STAKE</Text>
            <PinAmountInput value={hunterStake} onChangeText={setHunterStake} placeholder={`min ${MIN_HUNTER_STAKE}`} />
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

        {/* Live "all comers" preview (design §29.4) */}
        {R >= MIN_REWARD_PER_HUNTER && m >= MIN_MAX_HUNTERS && (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>HOW IT PAYS OUT</Text>
            <Text style={styles.previewLine}>You take on up to {formatPins(m)} hunters. Each stakes {formatPins(H)} pins to join.</Text>
            <Text style={styles.previewLine}>Every hunter wins the same: their stake back + {formatPins(R)} reward. Join order doesn't matter and more hunters never shrink anyone's payout.</Text>
            <Text style={styles.previewLine}>If the hunters win, you pay {formatPins(R)} per hunter who joined. If you win, you collect every stake.</Text>
            <Text style={styles.previewLine}>You escrow {formatPins(escrow)} pins now ({formatPins(R)} × {formatPins(m)}); any unused amount is returned at settlement.</Text>
            <Text style={styles.disclaimer}>This does not affect bowling gameplay.</Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Button
          label={submitting ? 'Posting…' : 'Post Bounty'}
          size="lg"
          onPress={submit}
          disabled={!!error || submitting}
          style={styles.submitBtn}
        />
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
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

  submitBtn: { marginTop: 18 },
})
