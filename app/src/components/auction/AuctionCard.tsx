import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { AuctionView, formatTimeRemaining } from '../../utils/auction'

interface Props {
  auction: AuctionView
  onPress: () => void
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
export default function AuctionCard({ auction: a, onPress }: Props) {
  const scheduled = a.status === 'scheduled'
  const open = a.status === 'open'
  const done = a.status === 'settled' || a.status === 'settled_no_winner'

  return (
    <TouchableOpacity
      style={[styles.card, scheduled && styles.cardDim]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>{a.itemIcon} {a.itemName}</Text>
        <Text style={[styles.status, open && styles.statusOpen]}>{STATUS_LABEL[a.status]}</Text>
      </View>
      <Text style={styles.description} numberOfLines={1}>{a.description}</Text>

      <View style={styles.amountRow}>
        <View style={styles.amountCell}>
          <Text style={styles.amountValue}>{a.minimumBid.toLocaleString()}</Text>
          <Text style={styles.amountLabel}>MIN BID</Text>
        </View>
        {open && (
          <View style={styles.amountCell}>
            <Text style={styles.amountValue}>{a.bidderCount}</Text>
            <Text style={styles.amountLabel}>{a.bidderCount === 1 ? 'BIDDER' : 'BIDDERS'}</Text>
          </View>
        )}
        <View style={styles.amountCell}>
          <Text style={styles.amountValue}>
            {open ? formatTimeRemaining(a.closesAt) : scheduled ? formatTimeRemaining(a.opensAt) : '—'}
          </Text>
          <Text style={styles.amountLabel}>{open ? 'CLOSES IN' : scheduled ? 'OPENS IN' : 'CLOSED'}</Text>
        </View>
      </View>

      {open && a.myBidAmount != null && <Text style={styles.bidTag}>BID PLACED</Text>}

      {done && (
        <Text style={styles.result}>
          {a.status === 'settled'
            ? `Won by ${a.winnerName} — ${a.winningPrice?.toLocaleString()} pins`
            : 'No sale — no valid bids'}
          {a.bounces.length > 0
            ? ` · ${a.bounces.length} check${a.bounces.length === 1 ? '' : 's'} bounced 💸`
            : ''}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardDim: { opacity: 0.7 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 17, color: colors.text, letterSpacing: 0.3, marginRight: 8 },
  status: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  statusOpen: { color: colors.success },
  description: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 2 },

  amountRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  amountCell: { flex: 1, alignItems: 'center' },
  amountValue: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },
  amountLabel: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1, color: colors.muted, marginTop: 1 },

  bidTag: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.success, letterSpacing: 1, marginTop: 6 },
  result: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.text, letterSpacing: 0.3, marginTop: 6 },
})
