import { View, Text, Switch, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  label: string
  description?: string
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

// A settings-list row with a native Switch — the preference-toggle idiom
// (first used by Notification Settings). Disabled rows dim as a unit.
export default function SettingToggleRow({ label, description, value, onChange, disabled }: Props) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.textCol}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.surface2, true: colors.accentDim }}
        thumbColor={value && !disabled ? colors.accent : colors.muted}
        ios_backgroundColor={colors.surface2}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 12,
  },
  rowDisabled: { opacity: 0.45 },
  textCol: { flex: 1 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, letterSpacing: 0.3 },
  description: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, lineHeight: 16, marginTop: 2 },
})
