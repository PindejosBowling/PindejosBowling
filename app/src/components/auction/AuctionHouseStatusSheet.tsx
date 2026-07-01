import { useState } from 'react'
import { View, Text, TextInput, Switch, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useUiStore } from '../../stores/uiStore'
import { AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE } from '../../utils/auction'
import { auctionHouseState } from '../../utils/supabase/db'

interface Props {
  // Admin kill-switch for the whole Auction House. Closing paints a stylized
  // status over the Pinsino tile and blocks entry to the screen; the message is
  // the copy players read on the tile. Mount conditionally so state resets.
  initialClosed: boolean
  initialMessage: string | null
  onClose: () => void
  onDone: () => void
}

export default function AuctionHouseStatusSheet({ initialClosed, initialMessage, onClose, onDone }: Props) {
  const { showToast } = useUiStore()
  const [closed, setClosed] = useState(initialClosed)
  const [message, setMessage] = useState(initialMessage ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      const trimmed = message.trim()
      const { error } = await auctionHouseState.setClosed(closed, trimmed || null)
      if (error) { showToast(error.message, 'error'); return }
      showToast(closed ? 'Auction House closed' : 'Auction House open', 'success')
      onDone()
      onClose()
    } catch {
      showToast('Failed to update status', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      title="Auction House Status"
      subtitle="Close the block and post a message on the tile"
      onClose={onClose}
      busy={saving}
      keyboardAvoiding
      footer={
        <>
          <Button
            label="Save Status"
            size="lg"
            onPress={submit}
            loading={saving}
            disabled={saving}
            style={styles.submitBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !saving && onClose()} />
        </>
      }
    >
      <View style={styles.closedRow}>
        <View style={styles.closedText}>
          <Text style={styles.closedLabel}>Closed</Text>
          <Text style={styles.closedSub}>
            {closed
              ? 'Players see the status over the tile and can’t enter.'
              : 'The Auction House is open for business.'}
          </Text>
        </View>
        <Switch
          value={closed}
          onValueChange={setClosed}
          disabled={saving}
          trackColor={{ false: colors.surface3, true: colors.accentDim }}
          thumbColor={closed ? colors.accent : colors.muted}
        />
      </View>

      <Text style={styles.label}>TILE MESSAGE</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={message}
        onChangeText={setMessage}
        editable={!saving}
        placeholder={AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE}
        placeholderTextColor={colors.muted2}
        multiline
        maxLength={80}
      />
      <Text style={styles.hint}>
        Shown on the tile while closed. Blank uses “{AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE}”.
      </Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  closedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  closedText: { flex: 1, marginRight: 12 },
  closedLabel: { fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3 },
  closedSub: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 16 },

  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2, borderRadius: radius.cardSm, borderWidth: 1, borderColor: colors.border2,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.barlow, fontSize: 15, color: colors.text,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  hint: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 16 },
  submitBtn: { marginTop: 14 },
})
