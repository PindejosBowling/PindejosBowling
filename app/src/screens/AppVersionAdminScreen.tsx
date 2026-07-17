import { useState, useCallback, useEffect } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import Toast from '../components/ui/Toast'
import EmptyCard from '../components/ui/EmptyCard'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { appVersionConfig as dbAppVersionConfig } from '../utils/supabase/db'
import type { Tables } from '../utils/supabase/database.types'

type AppVersionConfig = Tables<'app_version_config'>

// Admin editor for the update gate (app_version_config): the minimum native
// build version allowed to run, and the message the blocking screen shows.
// Raise the minimum after a native change ships on TestFlight so stranded
// builds (which can no longer receive OTA updates) are told to update instead
// of silently running stale JS. The client gate (useUpdateGate) fails open, so
// a bad value here can't brick the app — but it CAN lock every current build
// out until they update, so raise it deliberately.
export default function AppVersionAdminScreen() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const myPlayerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<AppVersionConfig | null>(null)
  const [minVersion, setMinVersion] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await dbAppVersionConfig.get()
      if (data) {
        setConfig(data)
        setMinVersion(data.min_supported_version)
        setMessage(data.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!config) return
    if (!/^\d+(\.\d+)*$/.test(minVersion.trim())) {
      showToast('Version must be dotted numbers, e.g. 1.0.24', 'error'); return
    }
    if (!message.trim()) {
      showToast('Message is required', 'error'); return
    }
    setSaving(true)
    try {
      const { error } = await dbAppVersionConfig.update(config.id, {
        min_supported_version: minVersion.trim(),
        message: message.trim(),
        updated_by: myPlayerId,
      })
      if (error) { showToast(error.message, 'error'); return }
      showToast('App version config saved', 'success')
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <ScreenContainer title="App Version" loading={loading} scroll={false}>
        <EmptyCard text="Admins only" style={{ marginHorizontal: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer
      title="App Version"
      subtitle="Minimum supported build (update gate)"
      loading={loading}
      overlay={<Toast />}
    >
      <Text style={styles.sectionHeader}>UPDATE GATE</Text>
      <View style={styles.card}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowLeft}>
            <Text style={styles.label}>Minimum version</Text>
            <Text style={styles.hint}>Builds below this see a blocking update screen</Text>
          </View>
          <TextInput
            style={styles.input}
            value={minVersion}
            onChangeText={setMinVersion}
            placeholder="1.0.23"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
        </View>

        <View style={styles.messageBlock}>
          <Text style={styles.label}>Blocking message</Text>
          <Text style={styles.hint}>Shown on the update screen</Text>
          <TextInput
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            placeholder="A new version of the app is required…"
            placeholderTextColor={colors.muted}
            multiline
          />
        </View>
      </View>
      <Text style={styles.warning}>
        Raising this locks out every install below it until they update on
        TestFlight. Set it to the version you just shipped, after it's live.
      </Text>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={save}
        disabled={saving}
        activeOpacity={0.8}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
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
    minWidth: 100,
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
  messageBlock: { paddingHorizontal: 14, paddingVertical: 14, gap: 6 },
  messageInput: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  warning: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginHorizontal: 16,
    marginTop: 8,
  },
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
