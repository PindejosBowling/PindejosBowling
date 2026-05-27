import React from 'react'
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'

interface Props {
  label?: string
}

export default function LoadingView({ label = 'Loading' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.accent} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    gap: 12,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
})
