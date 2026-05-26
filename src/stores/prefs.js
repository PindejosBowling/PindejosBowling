// src/stores/prefs.js — localStorage-backed user preferences store (AP-1)
// Holds preferences that survive page reloads.
// Lifecycle: initialized from localStorage on creation; persisted on every change.

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const usePrefsStore = defineStore('prefs', () => {
  // Matches app.js line 18: localStorage.getItem('pb_myname') || ''
  const myName = ref(localStorage.getItem('pb_myname') || '')

  // Matches app.js line 21: localStorage.getItem('pb_avgdisplay') || 'last-played'
  const avgDisplay = ref(localStorage.getItem('pb_avgdisplay') || 'last-played')

  // Persist changes back to localStorage automatically
  watch(myName,     val => localStorage.setItem('pb_myname', val))
  watch(avgDisplay, val => localStorage.setItem('pb_avgdisplay', val))

  return { myName, avgDisplay }
})
