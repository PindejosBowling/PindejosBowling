import { StyleSheet } from 'react-native'

export const colors = {
  bg:        '#0a0a0c',
  surface:   '#131316',
  surface2:  '#1c1c21',
  surface3:  '#25252b',
  border:    'rgba(255,255,255,0.08)',
  border2:   'rgba(255,255,255,0.14)',
  accent:    '#e8ff47',
  accentDim: 'rgba(232,255,71,0.12)',
  gold:      '#f4d03f',
  goldDim:   'rgba(244,208,63,0.12)',
  goldTint:  'rgba(244,208,63,0.05)',
  text:      '#f0f0f0',
  muted:     '#7a7a85',
  muted2:    '#55555e',
  success:     '#4ade80',
  successDim:  'rgba(74,222,128,0.12)',
  successTint: 'rgba(74,222,128,0.05)',
  danger:      '#ff4f6d',
  dangerDim:   'rgba(255,79,109,0.12)',
  dangerTint:  'rgba(255,79,109,0.05)',
  overlay:   'rgba(0,0,0,0.7)',
  shadow:    '#000',

  // Soft desaturated tints reserved for the ambient pixel-art backdrops
  // (components/pixelart/) — not for UI chrome.
  pixelArt: {
    teal:   '#6fa8a3',
    purple: '#8d7fb8',
    rose:   '#c2899c',
    sand:   '#c4ad85',
    wood:   '#5c4433', // dark wood — table rails, furniture silhouettes
  },
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
}

export const fonts = {
  barlow:               'Barlow_400Regular',
  barlowSemiBold:       'Barlow_600SemiBold',
  barlowCondensed:      'BarlowCondensed_700Bold',
  barlowCondensedHeavy: 'BarlowCondensed_900Black',
}

export const radius = {
  card:   18,
  cardMd: 14,
  cardSm: 12,
  icon:   10,
}

// Shared bottom-sheet form idioms — the SECTION heading, small-caps field
// label, multiline free-text input (reasoning / admin notes), and stacked
// action-button spacing previously re-declared per admin action sheet.
// Styles (not a component) because they dress plain <Text>/<TextInput>.
export const sheetStyles = StyleSheet.create({
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 12, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  actSpacing: { marginBottom: 8 },
})
