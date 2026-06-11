import React from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface ConfirmBarProps {
  icon: string
  title: string
  subtext?: string
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}

export default function ConfirmBar({ icon, title, subtext, saving, onDiscard, onSave }: ConfirmBarProps) {
  return (
    <View style={styles.bar}>
      {saving ? (
        <>
          <ActivityIndicator size="small" color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.icon}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtext && <Text style={styles.subtext}>{subtext}</Text>}
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251,191,36,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  icon: { fontSize: 18 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  subtext: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  btnDiscard: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
  },
  btnDiscardText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.gold,
    letterSpacing: 0.5,
  },
  btnSave: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    backgroundColor: colors.gold,
  },
  btnSaveText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
})
