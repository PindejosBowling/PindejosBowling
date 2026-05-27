<template>
  <button class="nav-btn" :class="{ active: uiStore.activeTab === 'matchups' }" @click="switchTo('matchups')">
    <span class="nav-icon">🎳</span>This Week
  </button>
  <button class="nav-btn" :class="{ active: uiStore.activeTab === 'rsvp' }" @click="switchTo('rsvp')">
    <span class="nav-icon">📋</span>RSVP
  </button>
  <button class="nav-btn" :class="{ active: uiStore.activeTab === 'standings' }" @click="switchTo('standings')">
    <span class="nav-icon">📊</span>Standings
  </button>
  <button class="nav-btn" :class="{ active: uiStore.activeTab === 'history' }" @click="switchTo('history')">
    <span class="nav-icon">🗓️</span>Matches
  </button>
  <button class="nav-btn" :class="{ active: uiStore.activeTab === 'more' }" @click="switchTo('more')">
    <span class="nav-icon">⋯</span>More
  </button>
</template>

<script setup>
import { watch } from 'vue'
import { useUiStore } from '../stores/ui.js'

const uiStore = useUiStore()

/**
 * Handle a nav-button click.
 * Clicking 'more' always resets to the home menu (preserveView=false for direct nav clicks).
 */
function switchTo(tab) {
  if (tab === 'more') uiStore.moreView = 'home'
  uiStore.setTab(tab)
}

/**
 * Bridge: keep the legacy section CSS classes (.section.active) in sync with the
 * Vue store so the existing index.html section divs show/hide correctly.
 * This watcher runs immediately on mount to apply the initial active state.
 */
watch(
  () => uiStore.activeTab,
  tab => {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
    document.getElementById('section-' + tab)?.classList.add('active')
  },
  { immediate: true }
)
</script>
