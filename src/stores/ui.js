// src/stores/ui.js — navigation and view state store (AP-1)
// Holds state that changes on tab switches and user interactions.
// Lifecycle: changes frequently; never persisted to localStorage.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // Top-level tab router (not in legacy state — was implicit via DOM)
  const activeTab = ref('matchups')

  // Navigation / view state
  const selectedPlayer  = ref(null)
  const moreView        = ref('home')
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

  function setTab(tab) {
    activeTab.value = tab
  }

  return {
    activeTab,
    selectedPlayer, moreView, matchupsView, expandedWeek, playerLogMode, oddsRevealed,
    standingsSeason, playerSeason, histSeason, histWeek,
    recordsSeason, chemMode, chemExpanded, h2hP1, h2hP2,
    setTab,
  }
})
