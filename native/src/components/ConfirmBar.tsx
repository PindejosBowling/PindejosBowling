import React from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../theme'

interface ConfirmBarProps {
  message: string
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}

export default function ConfirmBar({ message, saving, onDiscard, onSave }: ConfirmBarProps) {
  return (
    <View style={styles.bar}>
      {saving ? (
        <View style={styles.savingRow}>
          <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={styles.message}>{message}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnDiscard} onPress={onDiscard} activeOpacity={0.7}>
              <Text style={styles.btnDiscardText}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSave} onPress={onSave} activeOpacity={0.7}>
              <Text style={styles.btnSaveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: colors.border2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  message: {
    color: colors.text,
    fontFamily: fonts.barlow,
    fontSize: 14,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  btnDiscard: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  btnDiscardText: {
    color: colors.text,
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  btnSave: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
  },
  btnSaveText: {
    color: colors.bg,
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
})
