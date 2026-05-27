// src/stores/data.js — server data store (AP-1)
// Holds data fetched from the Google Apps Script API.
// Lifecycle: populated by loadAll(), invalidated on write-back.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet } from '../api.js'

export const useDataStore = defineStore('data', () => {
  // Server data
  const current   = ref(null)   // currentWeek from API
  const active    = ref(null)   // activeWeek from API (RSVP/scoring state)
  const roster    = ref(null)
  const rsvp      = ref(null)
  const stats     = ref(null)
  const board     = ref(null)
  const history   = ref(null)
  const champions = ref(null)
  const generated = ref(null)
  const settings  = ref(null)

  // Fetch state — not in legacy state object; added for Vue component use
  const loading = ref(false)
  const error   = ref(null)

  async function loadAll() {
    loading.value = true
    error.value = null
    try {
      const all = await apiGet('getAll')
      // Note: API response keys differ from store property names
      current.value   = all.currentWeek
      active.value    = all.activeWeek
      roster.value    = all.roster
      rsvp.value      = all.rsvp
      stats.value     = all.stats
      board.value     = all.board
      history.value   = all.history
      champions.value = all.champions
      generated.value = all.generated
      settings.value  = all.settings
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    current, active, roster, rsvp, stats, board,
    history, champions, generated, settings,
    loading, error,
    loadAll,
  }
})
