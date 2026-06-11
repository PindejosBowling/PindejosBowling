import React from 'react'
import { Text, StyleSheet } from 'react-native'
import type { TextStyle, StyleProp } from 'react-native'
import type { Badge } from '../../utils/badges'

// Renders a player's status emojis inline (e.g. after their name). Trivial today,
// but the single place to later add spacing, long-press labels, colored chips, etc.
export default function PlayerBadges({
  badges,
  style,
}: {
  badges: Badge[]
  style?: StyleProp<TextStyle>
}) {
  if (!badges.length) return null
  return <Text style={[styles.badges, style]}>{' ' + badges.map(b => b.emoji).join('')}</Text>
}

const styles = StyleSheet.create({
  badges: {},
})
