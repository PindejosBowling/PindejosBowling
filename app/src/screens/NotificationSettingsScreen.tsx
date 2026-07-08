import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, Linking, Platform } from 'react-native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import LoadingView from '../components/ui/LoadingView'
import Toast from '../components/ui/Toast'
import Button from '../components/ui/Button'
import SettingToggleRow from '../components/ui/SettingToggleRow'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { push } from '../utils/supabase/db'
import { useNotificationSettingsData } from '../hooks/useNotificationSettingsData'
import { syncPushToken } from '../utils/pushTokens'

// Notification Settings — the user's push opt-out surface (Push Broadcasts,
// context/push-broadcasts.md). One master switch over per-category toggles;
// opt-out is enforced server-side at send time, so these rows are the whole
// truth. Absent pref row = ON (the DB contract).
export default function NotificationSettingsScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()
  const { loading, rawCategories, rawMasterEnabled, rawCategoryEnabled, permission, reload } =
    useNotificationSettingsData()

  // Optimistic overrides layered over the raw (absent = ON) server state.
  const [masterOverride, setMasterOverride] = useState<boolean | null>(null)
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, boolean>>({})

  const masterEnabled = masterOverride ?? rawMasterEnabled ?? true
  const categories = useMemo(
    () =>
      rawCategories.map(c => ({
        ...c,
        enabled: categoryOverrides[c.id] ?? rawCategoryEnabled[c.id] ?? true,
      })),
    [rawCategories, rawCategoryEnabled, categoryOverrides],
  )

  const osBlocked = permission === 'denied'
  const toggleable = !osBlocked && permission !== 'unavailable' && !!playerId

  async function onToggleMaster(next: boolean) {
    if (!playerId) return
    setMasterOverride(next)
    const { error } = await push.setMaster(playerId, next)
    if (error) {
      setMasterOverride(null)
      showToast(error.message, 'error')
    }
  }

  async function onToggleCategory(categoryId: string, next: boolean) {
    if (!playerId) return
    setCategoryOverrides(prev => ({ ...prev, [categoryId]: next }))
    const { error } = await push.setCategoryPref(playerId, categoryId, next)
    if (error) {
      setCategoryOverrides(prev => {
        const { [categoryId]: _dropped, ...rest } = prev
        return rest
      })
      showToast(error.message, 'error')
    }
  }

  async function onEnablePush() {
    // undetermined → this triggers the one-shot iOS prompt and registers.
    await syncPushToken()
    reload()
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <ScreenContainer
      title="Notifications"
      subtitle="Choose what the league can send you"
      onRefresh={reload}
      overlay={<Toast />}
    >
      {permission === 'unavailable' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Push notifications aren't available here — they arrive on your phone via the iOS app.
            Your choices below still apply to every device.
          </Text>
        </View>
      )}

      {permission === 'undetermined' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Push is not set up on this device yet.
          </Text>
          <Button label="Enable Push Notifications" onPress={onEnablePush} style={styles.bannerBtn} />
        </View>
      )}

      {osBlocked && (
        <View style={[styles.banner, styles.bannerBlocked]}>
          <Text style={styles.bannerText}>
            Notifications are turned off for Pindejos in {Platform.OS === 'ios' ? 'iOS' : 'system'} Settings,
            so nothing can be delivered to this device.
          </Text>
          <Button
            variant="outline"
            label="Open Settings"
            onPress={() => Linking.openSettings()}
            style={styles.bannerBtn}
          />
        </View>
      )}

      <SettingToggleRow
        label="Push Notifications"
        description="The master switch — off means the league sends you nothing, ever."
        value={masterEnabled}
        onChange={onToggleMaster}
        disabled={!toggleable && permission !== 'unavailable'}
      />

      <Text style={styles.sectionHeader}>CATEGORIES</Text>
      {categories.map(c => (
        <SettingToggleRow
          key={c.id}
          label={c.label}
          description={c.description}
          value={c.enabled}
          onChange={next => onToggleCategory(c.id, next)}
          disabled={(!toggleable && permission !== 'unavailable') || !masterEnabled}
        />
      ))}

      <Text style={styles.footnote}>
        Choices apply across all your devices. Admin messages are filtered before sending — an
        opted-out category never reaches your phone.
      </Text>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border2,
    padding: 14,
    marginBottom: 16,
  },
  bannerBlocked: { borderColor: 'rgba(255,79,109,0.4)' },
  bannerText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text, lineHeight: 18 },
  bannerBtn: { marginTop: 12, paddingVertical: 10 },
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginTop: 10,
    marginBottom: 8,
  },
  footnote: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 12 },
})
