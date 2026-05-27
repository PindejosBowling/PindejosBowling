<template>
  <ActiveMatchupsPanel v-if="hasActiveWeek(dataStore.active)" />
  <LegacyMatchupsPanel v-else-if="dataStore.current" />
  <div v-else class="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading…</div>
  </div>
</template>

<script setup>
import { useDataStore } from '../stores/data.js'
import { hasActiveWeek } from '../utils/data.js'
import ActiveMatchupsPanel from '../components/ActiveMatchupsPanel.vue'
import LegacyMatchupsPanel from '../components/LegacyMatchupsPanel.vue'

const dataStore = useDataStore()
</script>
