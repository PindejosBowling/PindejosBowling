<template>
  <div class="logo-row">
    <span class="logo-emoji">🎳</span>
    <div class="logo"><span class="pin">PIN</span><span class="dejos">DEJOS</span></div>
    <div class="week-badge-wrap">
      <div class="week-badge">{{ weekLabel }}</div>
      <div class="season-badge">Season {{ currentSeason }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { getCurrentSeason, hasActiveWeek } from '../utils/data.js'
import { AW } from '../utils/constants.js'

const dataStore = useDataStore()

const currentSeason = computed(() =>
  getCurrentSeason(dataStore.stats, dataStore.settings)
)

const weekLabel = computed(() => {
  // Active Week takes priority — read week number from first data row
  if (hasActiveWeek(dataStore.active)) {
    const week = dataStore.active[1]?.[AW.WEEK] ?? ''
    return (typeof week === 'number' || /^\d+$/.test(String(week)))
      ? `Week ${week}`
      : (week || 'Week 1')
  }
  // Legacy Current Week sheet — first row, first column holds the week label
  if (dataStore.current) {
    const wStr = String(dataStore.current[0]?.[0] ?? '')
    if (!wStr) return 'Week 1'
    return wStr.toLowerCase().includes('week') ? wStr : `Week ${wStr}`
  }
  return 'Week 1'
})
</script>
