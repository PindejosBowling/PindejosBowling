import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { MoreStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function PlayoffsScreen() {
  const navigation = useNavigation<Nav>()
  const { loadAll, loading } = useDataStore()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('MoreHome')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Playoffs</Text>
          <Text style={styles.subtitle}>Coming soon</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>🏁</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel}>FORMAT</Text>
              <Text style={styles.cardValue}>Top 4 seeds + snake draft</Text>
              <Text style={styles.cardSub}>Seeds → 1, 2, 3, 4, 4, 3, 2, 1 picking remaining players</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>🏆</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel}>ROUND 1</Text>
              <Text style={styles.cardValue}>Top two scoring teams advance</Text>
              <Text style={styles.cardSub}>All 4 playoff teams play; cumulative pins decide who moves on</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>🥇</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel}>FINALS</Text>
              <Text style={styles.cardValue}>Top 2 head-to-head for championship; bottom 2 for 3rd</Text>
              <Text style={styles.cardSub}>Higher pin total wins each game</Text>
            </View>
          </View>
        </View>

        <Text style={styles.note}>
          The playoff hub will let you set seeds, run the snake draft on this screen, and score the
          playoff week.{'\n\n'}
          For now, run playoffs manually using Match History (scores record to the same Weekly Scores
          sheet).
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { marginRight: 12, padding: 4 },
  backText: { fontSize: 20, color: colors.text },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginTop: 1,
  },

  content: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.icon,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  cardBody: { flex: 1 },
  cardLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  cardValue: {
    fontFamily: fonts.barlowSemiBold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 4,
  },
  cardSub: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },

  note: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
  },
})
