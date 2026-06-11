import { ReactNode, useState } from 'react'
import { StyleSheet } from 'react-native'
import BottomSheet from './BottomSheet'
import Button from './Button'
import { useUiStore } from '../../stores/uiStore'

interface ConfirmActionSheetProps {
  title: string
  subtitle?: string
  // The explanatory/terms body.
  children: ReactNode
  confirmLabel: string
  confirmVariant?: 'primary' | 'gold' | 'danger'
  // The single db.ts RPC the confirm button fires.
  action: () => PromiseLike<{ error: { message: string } | null }>
  successMessage: string
  // Catch-all toast when the action throws (default 'Action failed');
  // `{ error }` results toast the server message instead.
  failureMessage?: string
  bodyMaxHeight?: number
  onClose: () => void
  onDone: () => void
}

// The single confirm-flow semantic for "terms sheet → one RPC" modals (borrow /
// bounty entry / PvP accept): owns the saving flag, the try/catch/finally, the
// error toast from the server message, the success toast, and the onDone()
// (reload) → onClose() ordering. Built on BottomSheet — mount conditionally,
// like every BottomSheet caller.
export default function ConfirmActionSheet({
  title,
  subtitle,
  children,
  confirmLabel,
  confirmVariant,
  action,
  successMessage,
  failureMessage,
  bodyMaxHeight,
  onClose,
  onDone,
}: ConfirmActionSheetProps) {
  const { showToast } = useUiStore()
  const [saving, setSaving] = useState(false)

  async function confirm() {
    setSaving(true)
    try {
      const { error } = await action()
      if (error) { showToast(error.message, 'error'); return }
      showToast(successMessage, 'success')
      onDone()
      onClose()
    } catch {
      showToast(failureMessage ?? 'Action failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      busy={saving}
      bodyMaxHeight={bodyMaxHeight}
      footer={
        <>
          <Button
            label={confirmLabel}
            variant={confirmVariant}
            size="lg"
            onPress={confirm}
            loading={saving}
            disabled={saving}
            style={styles.confirmBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      {children}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  confirmBtn: { marginTop: 18 },
})
