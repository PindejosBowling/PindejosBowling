import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { getCurrentSeason, hasActiveWeek } from '../utils/data.js'
import { AW } from '../utils/constants.js'

export default function AppHeader() {
  const { stats, settings, active, current } = useDataStore()

  const currentSeason = getCurrentSeason(stats, settings)

  let weekLabel = 'Week 1'
  if (hasActiveWeek(active)) {
    const week = active?.[1]?.[AW.WEEK] ?? ''
    weekLabel = (typeof week === 'number' || /^\d+$/.test(String(week)))
      ? `Week ${week}`
      : (week || 'Week 1')
  } else if (current) {
    const wStr = String(current[0]?.[0] ?? '')
    if (!wStr) {
      weekLabel = 'Week 1'
    } else {
      weekLabel = wStr.toLowerCase().includes('week') ? wStr : `Week ${wStr}`
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>🎳</Text>
      <View style={styles.logo}>
        <Text style={styles.pin}>PIN</Text>
        <Text style={styles.dejos}>DEJOS</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.weekLabel}>{weekLabel}</Text>
        <Text style={styles.seasonLabel}>Season {currentSeason}</Text>
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
