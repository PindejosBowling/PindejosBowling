// src/stores/ui.js — view and filter state store
// Holds state that changes on user interactions within views.
// Lifecycle: changes frequently; never persisted to localStorage.
// Navigation is handled by Vue Router — activeTab, setTab, moreView,
// and selectedPlayer have been removed.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // View state
  const matchupsView    = ref('scores')
  const expandedWeek    = ref(null)
  const playerLogMode   = ref('bowled')
  const oddsRevealed    = ref(false)

  // Filter state — per-view user controls
  const standingsSeason = ref(null)     // null → defaults to current season
  const playerSeason    = ref(null)     // null → defaults to current season
  const histSeason      = ref(null)
  const histWeek        = ref(null)
  const recordsSeason   = ref('all')
  const chemMode        = ref('pairs')
  const chemExpanded    = ref(false)
  const h2hP1           = ref(null)
  const h2hP2           = ref(null)

  return {
    matchupsView, expandedWeek, playerLogMode, oddsRevealed,
    standingsSeason, playerSeason, histSeason, histWeek,
    recordsSeason, chemMode, chemExpanded, h2hP1, h2hP2,
  }
})
