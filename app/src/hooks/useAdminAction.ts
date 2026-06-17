import { useState } from 'react'
import { Alert } from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'

// The shared admin-action machinery for the bounty / PvP admin sheets: `run`
// executes one RPC behind a saving flag (error toast from the server message,
// success toast, then onDone (reload) → onClose), and `confirm` wraps the
// native Alert for actions that need a yes/no gate first.
export function useAdminAction(onDone: () => void, onClose: () => void) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  async function run(successLabel: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    // Compliance read-only mode: neutralize every admin write sheet in one place.
    if (useAuthStore.getState().isReadOnly) {
      showToast('Login is temporarily unavailable.', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await fn()
      if (error) { showToast(error.message, 'error'); return }
      showToast(successLabel, 'success')
      onDone()
      onClose()
    } catch {
      showToast('Action failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  function confirm(title: string, message: string, onYes: () => void, destructive = true) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: destructive ? 'destructive' : 'default', onPress: onYes },
    ])
  }

  return { saving, run, confirm }
}
