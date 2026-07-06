import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenContainer from '../components/ui/ScreenContainer'
import { useAuthStore } from '../stores/authStore'
import EmptyCard from '../components/ui/EmptyCard'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const TILE_WIDTH = (Dimensions.get('window').width - 48) / 3

// Related "registration" concerns: joining the league, enrolling in a season,
// and the member profile pictures.
const MENU_TILES: { icon: string; label: string; route: 'PlayerManagement' | 'SeasonRegistration' | 'ProfilePictures' }[] = [
  { icon: '👥', label: 'League Members', route: 'PlayerManagement' },
  { icon: '🗓️', label: 'Season Registration', route: 'SeasonRegistration' },
  { icon: '🖼️', label: 'Profile Pictures', route: 'ProfilePictures' },
]

export default function RegistrationAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  if (!isAdmin) {
    return (
      <ScreenContainer title="Registration Admin">
        <EmptyCard text="Admins only" style={{ margin: 16 }} />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer title="Registration Admin">
      <View style={styles.grid}>
        {MENU_TILES.map(tile => (
          <TouchableOpacity
            key={tile.route}
            style={styles.tile}
            onPress={() => navigation.navigate(tile.route)}
            activeOpacity={0.7}
          >
            <Text style={styles.tileIcon}>{tile.icon}</Text>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginBottom: 24,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 84,
  },
  tileIcon: { fontSize: 26, marginBottom: 6 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
})
