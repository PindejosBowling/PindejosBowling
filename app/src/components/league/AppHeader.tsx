import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts } from '../../theme'
import { weeks, seasons } from '../../utils/supabase/db'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import ProfileMenuModal from './ProfileMenuModal'
import PlayerAvatar from '../ui/PlayerAvatar'
import ArtworkToggle from '../ui/ArtworkToggle'

// `artworkToggle` shows the Artwork reveal button next to the profile — only on
// tab-home screens that actually have a pixel-art backdrop (the Pinsino landing).
// `onHelp`, when provided, shows a small "?" button before the avatar (the
// Pinsino landing uses it to open its how-it-works screen). Both are opt-in so
// other screens that mount AppHeader are unchanged.
export default function AppHeader({
  artworkToggle = false,
  onHelp,
}: {
  artworkToggle?: boolean
  onHelp?: () => void
}) {
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const playerName = useAuthStore(s => s.playerName)
  const playerId = useAuthStore(s => s.playerId)
  const weekVersion = useUiStore(s => s.weekVersion)

  useEffect(() => {
    Promise.all([weeks.getLatestOfCurrentSeason(), seasons.getCurrent()]).then(([weekRes, seasonRes]) => {
      setWeekNumber(weekRes.data?.week_number ?? null)
      setSeasonNumber(seasonRes.data?.number ?? null)
    })
  }, [weekVersion])

  const weekLabel = weekNumber != null ? `Week ${weekNumber}` : ''
  const seasonLabel = seasonNumber != null ? `Season ${seasonNumber}` : ''
  const subline = [seasonLabel, weekLabel].filter(Boolean).join('  ·  ')

  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>🎳</Text>
      <View style={styles.left}>
        <View style={styles.logo}>
          <Text style={styles.pin}>PIN</Text>
          <Text style={styles.dejos}>DEJOS</Text>
        </View>
        <Text style={styles.subline}>{subline}</Text>
      </View>
      {artworkToggle && <ArtworkToggle />}
      {onHelp && (
        <TouchableOpacity onPress={onHelp} activeOpacity={0.7} style={styles.helpBtn} accessibilityLabel="How it works">
          <Text style={styles.helpIcon}>?</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => setShowProfile(true)} activeOpacity={0.7} style={styles.avatarBtn}>
        <PlayerAvatar name={playerName} playerId={playerId} size={45} />
      </TouchableOpacity>
      <ProfileMenuModal visible={showProfile} onClose={() => setShowProfile(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 24,
    paddingVertical: 10,
    // Transparent on purpose: screens mount ambient pixel-art backdrops behind
    // the header (e.g. the Pinsino landing) and the art must show through.
  },
  emoji: {
    fontSize: 24,
    marginRight: 8,
  },
  avatarBtn: { marginLeft: 12 },
  helpBtn: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpIcon: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    color: colors.accent,
    lineHeight: 22,
  },
  left: {
    flex: 1,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  pin: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.accent,
    letterSpacing: 1,
  },
  dejos: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.text,
    letterSpacing: 1,
  },
  subline: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    letterSpacing: 0.5,
    marginTop: 1,
  },
})
