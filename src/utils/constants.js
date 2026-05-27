// src/utils/constants.js — sheet column indices

// Stats sheet (SC) columns
export const SC = {
  SEASON:  0,
  WEEK:    1,
  PLAYER:  2,
  TEAM:    3,
  G1:      4,
  G1_OPP:  5,
  G2:      6,
  G2_OPP:  7,
  PINS:    8,
  WINS:    9,
  LOSSES:  10,
  GAMES:   11,
  PRESENT: 12,
}

// Active Week sheet (AW) columns — v6.3 schema (supports up to 3 games per night)
export const AW_SEASON  = 0
export const AW_WEEK    = 1
export const AW_TEAM    = 2
export const AW_SLOT    = 3
export const AW_NAME    = 4
export const AW_G1      = 5
export const AW_G2      = 6
export const AW_G3      = 7
export const AW_G1_OPP  = 8
export const AW_G2_OPP  = 9
export const AW_G3_OPP  = 10
export const AW_IS_FILL = 11
