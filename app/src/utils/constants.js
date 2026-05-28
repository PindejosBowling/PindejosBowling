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
export const AW = {
  SEASON:  0,
  WEEK:    1,
  TEAM:    2,
  SLOT:    3,
  NAME:    4,
  G1:      5,
  G2:      6,
  G3:      7,
  G1_OPP:  8,
  G2_OPP:  9,
  G3_OPP:  10,
  IS_FILL: 11,
}
