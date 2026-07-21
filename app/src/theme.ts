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

  // Tinted fills for the modern surface language: soft white washes for
  // chip/row rest states (instead of hairline-divided flat lists) and an
  // accent-cast wash for staged/parlay ticket cards.
  surfaceTint:  'rgba(255,255,255,0.04)',
  surfaceTint2: 'rgba(255,255,255,0.07)',
  chipBorder:   'rgba(255,255,255,0.22)',
  accentTint:   'rgba(232,255,71,0.06)',

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
  xxl: 32,
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

// The deliberate type scale for the betting surfaces — micro-labels, chip
// text, and big ticket values. Spread into StyleSheet entries (they're plain
// objects, not styles) so headings/numbers share one rhythm instead of
// per-component ad-hoc sizes.
export const type = {
  label:  { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5 },
  chip:   { fontFamily: fonts.barlowCondensed, fontSize: 13, letterSpacing: 0.5 },
  chipLg: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 16, letterSpacing: 0.5 },
  value:  { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20 },
} as const

// The ticket-card language: one card = one bet (the slip's build tickets and
// the placed-bet rows share this shell via TicketCard). Styles (not a
// component) so TicketCard and one-off ticket-shaped surfaces stay in sync.
export const ticketStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border2,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardGold: { borderColor: colors.gold, backgroundColor: colors.goldTint },
  // Accent top rail — the ticket's "edge".
  rail: {
    height: 3,
    borderTopLeftRadius: radius.cardMd,
    borderTopRightRadius: radius.cardMd,
    backgroundColor: colors.accentDim,
  },
  // The "perforation" between a ticket's legs and its stake/footer.
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderStyle: 'dashed',
    marginVertical: spacing.sm,
  },
})

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
