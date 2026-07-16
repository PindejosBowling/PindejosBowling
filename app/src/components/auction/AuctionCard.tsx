import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import Button from '../ui/Button'
import EconomyCard, { StatCell } from '../ui/EconomyCard'
import { AuctionView, formatTimeRemaining } from '../../utils/auction'
import { formatPins } from '../../utils/formatting'

interface Props {
  auction: AuctionView
  onPress: () => void
  // Open the bid sheet directly from the list (hub bid-from-card). Omit to
  // hide the button (read-only seasons); it also hides itself once the close
  // time passes (the HAMMER FALLING window — no bids while the cron settles).
  onBid?: () => void
}

const STATUS_LABEL: Record<AuctionView['status'], string> = {
  scheduled: 'SCHEDULED',
  open: 'OPEN',
  settled: 'SETTLED',
  settled_no_winner: 'NO SALE',
}

// One auction row for the Auction House list. Sealed-bid social contract:
// the card carries a BID PLACED tag only — the amount is never rendered here
// (it lives behind the owner-only reveal on the detail screen).
export default function AuctionCard({ auction: a, onPress, onBid }: Props) {
  const scheduled = a.status === 'scheduled'
  const open = a.status === 'open'
  const done = a.status === 'settled' || a.status === 'settled_no_winner'
  const hammerFalling = open && new Date(a.closesAt).getTime() <= Date.now()

  const stats: StatCell[] = [
    { value: formatPins(a.minimumBid), label: 'MIN BID' },
  ]
  if (open) stats.push({ value: String(a.bidderCount), label: a.bidderCount === 1 ? 'BIDDER' : 'BIDDERS' })
  stats.push({
    value: open ? formatTimeRemaining(a.closesAt) : scheduled ? formatTimeRemaining(a.opensAt) : '—',
    label: open ? 'CLOSES IN' : scheduled ? 'OPENS IN' : 'CLOSED',
  })

  return (
    <EconomyCard
      title={`${a.itemIcon} ${a.itemName}${a.quantity > 1 ? ` ×${a.quantity}` : ''}`}
      badge={{ text: STATUS_LABEL[a.status], color: open ? colors.success : undefined }}
      // Lead with the item's direct impact (catalog effect line) so the card
      // answers "what does this do" at a glance; the auction's own pitch copy
      // (legacy hand-written descriptions) stays on the detail screen.
      subtitle={a.itemEffectLine || a.description}
      subtitleLines={0}
      stats={stats}
      dim={scheduled}
      onPress={onPress}
    >
      {open && a.myBidAmount != null && <Text style={styles.bidTag}>BID PLACED</Text>}

      {open && !hammerFalling && onBid != null && (
        <Button
          label={a.myBidAmount != null ? 'Edit Bid' : 'Place Sealed Bid'}
          variant={a.myBidAmount != null ? 'outline' : 'primary'}
          onPress={onBid}
          style={styles.bidBtn}
        />
      )}

      {done && (
        <Text style={styles.result}>
          {a.status === 'settled'
            ? a.quantity > 1
              ? `${a.winners.length} of ${a.quantity} sold — top bid ${formatPins(a.winningPrice ?? 0)} pins`
              : `Won by ${a.winnerName} — ${formatPins(a.winningPrice ?? 0)} pins`
            : 'No sale — no valid bids'}
          {a.bounces.length > 0
            ? ` · ${a.bounces.length} check${a.bounces.length === 1 ? '' : 's'} bounced 💸`
            : ''}
        </Text>
      )}
    </EconomyCard>
  )
}

const styles = StyleSheet.create({
  bidTag: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.success, letterSpacing: 1, marginTop: 6 },
  bidBtn: { marginTop: 10 },
  result: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.text, letterSpacing: 0.3, marginTop: 6 },
})
