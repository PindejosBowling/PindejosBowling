import React, { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet } from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { colors, fonts, radius } from '../theme'

export default function Toast() {
  const { toasts } = useUiStore()
  const toast = toasts[toasts.length - 1]
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!toast) return
    opacity.setValue(0)
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start()
  }, [toast?.id])

  if (!toast) return null

  const bgColor =
    toast.type === 'success' ? colors.success :
    toast.type === 'error' ? colors.danger :
    colors.surface3

  const textColor = (toast.type === 'success' || toast.type === 'error') ? '#0a0a0c' : colors.text

  return (
    <Animated.View style={[styles.container, { backgroundColor: bgColor, opacity }]} pointerEvents="none">
      <Text style={[styles.msg, { color: textColor }]}>{toast.msg}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.cardMd,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  msg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
})
