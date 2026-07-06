import { useState } from 'react'
import { Platform } from 'react-native'

// State machine for a DateTimePicker slot: the picked value, whether the picker
// is showing, and the onChange handler with the platform quirk handled in one
// place — Android's picker is a one-shot dialog that must be dismissed on every
// change event (including cancel, when `selected` is undefined), while iOS
// 'inline' stays mounted until the caller toggles it closed. Screens with
// multiple pickers use one instance per date and close the others on toggle.
export function useDatePicker(initial: Date | (() => Date)) {
  const [value, setValue] = useState<Date>(initial)
  const [open, setOpen] = useState(false)

  function onChange(_e: unknown, selected?: Date) {
    if (Platform.OS === 'android') setOpen(false)
    if (selected) setValue(selected)
  }

  return { value, setValue, open, setOpen, onChange }
}
