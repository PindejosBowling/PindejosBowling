import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import PinsinoNoirBackdrop from '../components/pixelart/PinsinoNoirBackdrop'
import ScreenContainer from '../components/ui/ScreenContainer'
import FeatureAccordion from '../components/pinsino/FeatureAccordion'
import { EXPLAINERS, PinsinoFeatureKey } from '../data/pinsinoExplainers'
import { SHOW_AUCTION_HOUSE } from '../utils/featureFlags'

// Player-facing explainer for the Pinsino. All copy lives in
// data/pinsinoExplainers.ts (shared with the per-screen "?" sheets and hub
// tiles) — this screen just orders the sections. The Auction House and Items
// sections are gated on the same flag as the Auction House tile: items enter
// play via the auction block.
const GAMES: PinsinoFeatureKey[] = ['sportsbook', 'statProps', 'pvp', 'bounties']
const MONEY: PinsinoFeatureKey[] = SHOW_AUCTION_HOUSE
  ? ['loanShark', 'auctionHouse', 'items', 'marketMoves']
  : ['loanShark', 'marketMoves']

export default function PinsinoHelpScreen() {
  return (
    <ScreenContainer
      title="How the Pinsino Works"
      subtitle="Plain-English house rules"
      backdrop={<PinsinoNoirBackdrop />}
      contentStyle={styles.content}
    >
        {/* Intro — what pins are */}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>IT ALL RUNS ON PINS</Text>
          <Text style={styles.introBody}>
            Pins are the league currency. You earn them by bowling, then win or lose them across
            the Pinsino. You can never wager more pins than you're holding, and everyone starts from a clean slate when the season resets.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>THE GAMES</Text>
        {GAMES.map(key => {
          const e = EXPLAINERS[key]
          return (
            <FeatureAccordion
              key={key}
              icon={e.icon}
              title={e.title}
              hook={e.hook}
              bullets={e.bullets}
              caveat={e.caveat}
            />
          )
        })}

        <Text style={styles.sectionLabel}>THE MONEY</Text>
        {MONEY.map(key => {
          const e = EXPLAINERS[key]
          return (
            <FeatureAccordion
              key={key}
              icon={e.icon}
              title={e.title}
              hook={e.hook}
              bullets={e.bullets}
              caveat={e.caveat}
            />
          )
        })}

        <Text style={styles.footer}>The house always remembers.</Text>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  // Differs from the ScreenContainer default: flexGrow + shorter bottom pad.
  content: { flexGrow: 1, paddingBottom: 32 },

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
