import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import { weeks, seasons } from '../utils/supabase/db'

export default function AppHeader() {
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([weeks.getCurrent(), seasons.getLatest()]).then(([weekRes, seasonRes]) => {
      setWeekNumber(weekRes.data?.week_number ?? null)
      setSeasonNumber(seasonRes.data?.number ?? null)
    })
  }, [])

  const weekLabel = weekNumber != null ? `Week ${weekNumber}` : 'Week 1'
  const seasonLabel = seasonNumber != null ? `Season ${seasonNumber}` : ''

  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>🎳</Text>
      <View style={styles.logo}>
        <Text style={styles.pin}>PIN</Text>
        <Text style={styles.dejos}>DEJOS</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.weekLabel}>{weekLabel}</Text>
        {seasonLabel ? <Text style={styles.seasonLabel}>{seasonLabel}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bg,
  },
  emoji: {
    fontSize: 24,
    marginRight: 8,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  pin: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 22,
    color: colors.accent,
    letterSpacing: 1,
  },
  dejos: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 1,
  },
  badge: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  weekLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.accent,
    letterSpacing: 1,
  },
  seasonLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
  },
})
