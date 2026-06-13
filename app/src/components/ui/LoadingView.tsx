import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'

// How long a `delayed` LoadingView stays empty before admitting it's loading.
const DELAYED_SPINNER_MS = 5000

interface Props {
  label?: string
  // Drop the solid background so a screen backdrop can warm up behind the
  // spinner (the caller's container must provide its own colors.bg).
  transparent?: boolean
  // Hide the spinner entirely for the first 5s: screen transitions read as an
  // instant art/background change, and the spinner only appears if loading
  // genuinely drags on.
  delayed?: boolean
}

export default function LoadingView({ label = 'Loading', transparent = false, delayed = false }: Props) {
  const [showSpinner, setShowSpinner] = useState(!delayed)
  useEffect(() => {
    if (!delayed) return
    const t = setTimeout(() => setShowSpinner(true), DELAYED_SPINNER_MS)
    return () => clearTimeout(t)
  }, [delayed])

  return (
    <View style={[styles.container, transparent && styles.transparent]}>
      {showSpinner && <ActivityIndicator size="large" color={colors.accent} />}
      {showSpinner && label ? <Text style={styles.label}>{label}</Text> : null}
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
  transparent: { backgroundColor: 'transparent' },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
})
