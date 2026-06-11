import React from 'react'
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { initials } from '../../utils/helpers'
import { useAvatarStore } from '../../stores/avatarStore'

interface Props {
  name?: string | null
  playerId?: string | null
  size?: number
  style?: StyleProp<ViewStyle>
}

// Renders a player's profile picture (private bucket → signed URL from useAvatarStore),
// falling back to an initials circle when the player has no photo.
export default function PlayerAvatar({ name, playerId, size = 36, style }: Props) {
  const url = useAvatarStore((s) =>
    (playerId && s.byId[playerId]) ||
    (name && s.byName[name.toLowerCase()]) ||
    undefined,
  )

  const dims = {
    width: size,
    height: size,
    borderRadius: size <= 24 ? radius.icon : radius.cardSm,
  }

  if (url) {
    return <Image source={{ uri: url }} style={[styles.base, dims, style] as StyleProp<ImageStyle>} />
  }

  return (
    <View style={[styles.base, styles.fallback, dims, style]}>
      <Text style={[styles.text, { fontSize: Math.max(10, size * 0.4) }]}>
        {name ? initials(name) : '?'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.accentDim,
  },
  fallback: {
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.barlowCondensedHeavy,
    color: colors.accent,
    letterSpacing: 0.5,
  },
})
