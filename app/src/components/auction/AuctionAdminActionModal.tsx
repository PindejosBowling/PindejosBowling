import { Text, ActivityIndicator, Alert } from 'react-native'
import { colors, sheetStyles } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { useAdminAction } from '../../hooks/useAdminAction'
import { AuctionView } from '../../utils/auction'
import { auctions } from '../../utils/supabase/db'

interface Props {
  // Admin actions by status. Deliberately NO bid inspection — admins are
  // players too; sealed means sealed (FINDINGS §8). Mount conditionally.
  auction: AuctionView
  onClose: () => void
  onDone: () => void
  onEdit: () => void
}

export default function AuctionAdminActionModal({ auction: a, onClose, onDone, onEdit }: Props) {
  const { saving, run, confirm } = useAdminAction(onDone, onClose)
  const settled = a.status === 'settled' || a.status === 'settled_no_winner'

  function cancel() {
    Alert.alert(
      'Cancel this auction?',
      'This erases the auction and every sealed bid — nothing has been paid, nothing is owed. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Erase auction', style: 'destructive', onPress: () => run('Auction cancelled', () => auctions.cancel(a.id)) },
      ],
    )
  }

  function reverse() {
    Alert.alert(
      'Reverse this settlement?',
      'Claws back the winning purchase, revokes the item, and erases the auction as if it never happened. Fails if the item has already been used. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Reverse settlement', style: 'destructive', onPress: () => run('Auction reversed', () => auctions.reverse(a.id)) },
      ],
    )
  }

  return (
    <BottomSheet
      title={`${a.itemIcon} ${a.itemName}`}
      subtitle={`${a.status.replace('_', ' ').toUpperCase()} · ${a.bidderCount} bidder${a.bidderCount === 1 ? '' : 's'}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />}
          <Button variant="ghost" label="Close" onPress={() => !saving && onClose()} />
        </>
      }
    >
      {a.status === 'scheduled' && (
        <>
          <Text style={sheetStyles.section}>SCHEDULED</Text>
          <Button variant="outline" label="Edit auction" disabled={saving} onPress={onEdit} style={sheetStyles.actSpacing} />
          <Button
            variant="outline"
            label="Open now"
            disabled={saving}
            onPress={() => confirm('Open now?', 'Bidding starts immediately.', () => run('Auction opened', () => auctions.openNow(a.id)), false)}
            style={sheetStyles.actSpacing}
          />
        </>
      )}

      {a.status === 'open' && (
        <>
          <Text style={sheetStyles.section}>OPEN</Text>
          <Button
            variant="outline"
            label="Settle now"
            disabled={saving}
            onPress={() =>
              confirm(
                'Settle now?',
                'Closes bidding immediately and settles against the sealed bids (or marks no-sale if there are none).',
                () => run('Auction settled', () => auctions.settle(a.id)),
                false,
              )}
            style={sheetStyles.actSpacing}
          />
        </>
      )}

      <Text style={sheetStyles.section}>DESTRUCTIVE</Text>
      {settled ? (
        <Button variant="outline" tone="danger" label="Reverse settlement" disabled={saving} onPress={reverse} style={sheetStyles.actSpacing} />
      ) : (
        <Button variant="outline" tone="danger" label="Cancel (erase auction)" disabled={saving} onPress={cancel} style={sheetStyles.actSpacing} />
      )}
    </BottomSheet>
  )
}

