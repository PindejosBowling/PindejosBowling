import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'
import { weeks, seasons } from '../utils/supabase/db'
import { useAuthStore } from '../stores/authStore'
import { initials } from '../utils/helpers'

export default function AppHeader() {
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const playerName = useAuthStore(s => s.playerName)

  useEffect(() => {
    Promise.all([weeks.getCurrent(), seasons.getLatest()]).then(([weekRes, seasonRes]) => {
      setWeekNumber(weekRes.data?.week_number ?? null)
      setSeasonNumber(seasonRes.data?.number ?? null)
    })
  }, [])

  const weekLabel = weekNumber != null ? `Week ${weekNumber}` : 'Week 1'
  const seasonLabel = seasonNumber != null ? `Season ${seasonNumber}` : ''
  const subline = seasonLabel ? `${seasonLabel}  ·  ${weekLabel}` : weekLabel

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
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {playerName ? initials(playerName) : '?'}
        </Text>
      </View>
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
    backgroundColor: colors.bg,
  },
  emoji: {
    fontSize: 24,
    marginRight: 8,
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
  avatar: {
    width: 45,
    height: 45,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    color: colors.accent,
    letterSpacing: 0.5,
  },
})
