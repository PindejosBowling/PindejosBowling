import { ActivityIndicator } from 'react-native'
import { colors } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useAdminAction } from '../../hooks/useAdminAction'
import { customLines } from '../../utils/supabase/db'

interface Props {
  // Mounted conditionally so it resets between opens. `line` is a raw
  // custom_lines row (the admin list works on raw rows, not resolved views).
  // None of these actions move pins: bets already placed hold concrete
  // selections and settle normally whatever happens to the line.
  line: any
  onClose: () => void
  onDone: () => void
  onEdit: () => void
}

export default function CustomLineAdminActionModal({ line, onClose, onDone, onEdit }: Props) {
  const { saving, run, confirm } = useAdminAction(onDone, onClose)

  function remove() {
    confirm(
      'Delete this special?',
      'It comes off the board immediately. Bets already placed keep their selections and settle normally — only the board offering disappears. This cannot be undone.',
      () => run('Special deleted', () => customLines.remove(line.id)),
    )
  }

  const legCount = Array.isArray(line.legs) ? line.legs.length : 0
  const scopeLabel = line.week_ids == null
    ? 'EVERY WEEK'
    : `${line.week_ids.length} WEEK${line.week_ids.length === 1 ? '' : 'S'}`

  return (
    <BottomSheet
      title={line.title}
      subtitle={`${scopeLabel} · ${legCount} LEG${legCount === 1 ? '' : 'S'} · ${line.is_active ? 'ACTIVE' : 'DISABLED'}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <Button variant="outline" label="Edit" disabled={saving} onPress={onEdit} style={{ marginBottom: 8 }} />
      <Button
        variant="outline"
        label={line.is_active ? 'Disable (hide from board)' : 'Enable'}
        disabled={saving}
        onPress={() => run(
          line.is_active ? 'Special disabled' : 'Special enabled',
          () => customLines.update(line.id, { is_active: !line.is_active }),
        )}
        style={{ marginBottom: 8 }}
      />
      <Button variant="outline" tone="danger" label="Delete" disabled={saving} onPress={remove} style={{ marginBottom: 8 }} />
    </BottomSheet>
  )
}
