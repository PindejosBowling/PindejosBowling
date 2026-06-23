import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import PinsinoNoirBackdrop from '../components/pixelart/PinsinoNoirBackdrop'
import ScreenHeader from '../components/ui/ScreenHeader'
import FeatureAccordion from '../components/pinsino/FeatureAccordion'
import { SHOW_AUCTION_HOUSE } from '../utils/featureFlags'

// Player-facing explainer for the Pinsino. Pure copy — no data layer. Each live
// Pinsino feature gets one collapsible section, in the same order as the landing
// tiles. The Auction House section is gated on the same flag as its tile.
export default function PinsinoHelpScreen() {
  const navigation = useNavigation()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PinsinoNoirBackdrop />
      <ScreenHeader
        title="How the Pinsino Works"
        subtitle="Plain-English house rules"
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Intro — what pins are */}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>IT ALL RUNS ON PINS</Text>
          <Text style={styles.introBody}>
            Pins are the league currency. You earn them by bowling, then win or lose them across
            the Pinsino. Your balance is real money on the table — you can never wager more pins
            than you're holding, and everyone starts fresh when the season resets.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>THE GAMES</Text>

        <FeatureAccordion
          icon="🏟️"
          title="Sportsbook"
          hook="Bet on the bowling."
          bullets={[
            'Back a player to beat their projected line for the week, or back your own team to win its matchup.',
            'Stack multiple picks into a parlay — every leg has to hit, but the payout multiplies.',
            'Night stat props (strikes, spares, clean frames) open up once the lane data is in.',
            'Tickets settle automatically when the week is finalized.',
          ]}
          caveat="You back the over, or back your own team — those are the sides the house puts on the board."
        />

        <FeatureAccordion
          icon="⚔️"
          title="PvP Challenges"
          hook="Go head-to-head with a rival."
          bullets={[
            'Send a challenge to a specific player, or post it to the open board for anyone to take.',
            'Both sides stake equal pins into escrow — the house holds them, and takes no cut.',
            'Winner takes the whole pot. It settles automatically off the week’s scores.',
            'Lose one? You can offer a double-or-nothing rematch.',
          ]}
        />

        <FeatureAccordion
          icon="🎯"
          title="Bounties"
          hook="Hunt the house's challenges."
          bullets={[
            'The house posts a bounty with a target — pay the entry to join the hunt.',
            'If any hunter pulls it off, every hunter cashes in (your stake back plus a protected profit).',
            'More hunters joining never shrinks your cut — your profit is locked when you enter.',
          ]}
          caveat="For now, bounties are posted and settled by the house."
        />

        <Text style={styles.sectionLabel}>THE MONEY</Text>

        <FeatureAccordion
          icon="🦈"
          title="Loan Shark"
          hook="Borrow now, bowl it off later."
          bullets={[
            'Take a loan for an instant pile of pins to put into play.',
            'The debt charges interest every week, and a slice of your weekly bowling score is garnished to pay it down.',
            'You can repay early, in part or in full, anytime — no penalty.',
          ]}
          caveat="Interest compounds, so the bigger loans can spiral. What counts is net worth: balance minus debt."
        />

        {SHOW_AUCTION_HOUSE && (
          <FeatureAccordion
            icon="📣"
            title="Auction House"
            hook="Sealed-bid auctions for scarce goods."
            bullets={[
              'The house lists something rare. You submit a single hidden bid — nobody sees what anyone else pledged.',
              'When it closes, the highest bidder who can still cover their bid wins and pays it.',
            ]}
            caveat="Bids are pledges, not held pins. Be able to cover yours at settlement, or take a small bounce penalty."
          />
        )}

        <FeatureAccordion
          icon="👀"
          title="Market Moves"
          hook="The league's money newswire."
          bullets={[
            'A live feed of the notable action — big tickets, parlay hits, loans, settled challenges, and bounty and auction results.',
            'Tap any card to jump straight to the action behind it.',
          ]}
        />

        <Text style={styles.footer}>The house always remembers.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 },

  intro: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginTop: 8,
    marginBottom: 20,
  },
  introTitle: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    letterSpacing: 1,
    color: colors.accent,
    marginBottom: 8,
  },
  introBody: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    lineHeight: 21,
  },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 12,
  },

  footer: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },
})
