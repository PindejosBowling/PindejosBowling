// src/stores/pending.js — transient / pending state store (AP-1)
// Holds unsaved local edits: RSVP changes, score entries, team generator state.
// Lifecycle: either committed (written to API) or discarded.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePendingStore = defineStore('pending', () => {
  // Unsaved RSVP changes — map of player name → rsvp status
  const pendingRSVP   = ref({})
  // Unsaved score entries — map of player/slot key → score value
  const pendingScores = ref({})

  // Team generator state
  const genFillMode   = ref('League Avg')
  const genAvgSource  = ref('last-season')
  const genTeams      = ref(null)
  const genNumTeams   = ref(4)
  const genTeamSize   = ref(3)
  const genFillToSize = ref(false)
  const genSwapTarget = ref(null)

  return {
    pendingRSVP, pendingScores,
    genFillMode, genAvgSource, genTeams,
    genNumTeams, genTeamSize, genFillToSize, genSwapTarget,
  }
})
