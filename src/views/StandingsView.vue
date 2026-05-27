<template>
  <div v-if="dataStore.loading || !dataStore.stats" class="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading standings</div>
  </div>
  <div v-else>
    <div class="tab-title">Standings</div>
    <div class="filter-bar">
      <select @change="uiStore.standingsSeason = $event.target.value">
        <option
          v-for="s in seasons"
          :key="s"
          :value="s"
          :selected="s === activeSeason"
        >{{ s === 'all' ? 'All-time' : 'Season ' + s }}</option>
      </select>
    </div>
    <div class="standings-card">
      <div class="standings-header">
        <span>#</span>
        <span>Bowler</span>
        <span>W—L</span>
        <span>Pins</span>
        <span>Avg</span>
      </div>
      <div
        v-for="(player, index) in standings"
        :key="player.name"
        class="standing-row"
        @click="goToPlayer(player.name)"
      >
        <span :class="['s-rank', { top: index < 3 }]">{{ index + 1 }}</span>
        <span class="s-name">
          {{ player.name }}
          <span v-if="isChampion(dataStore.champions, player.name)" class="champ-crown" title="Past champion">👑</span>
        </span>
        <span class="s-wl">{{ player.wins }}–{{ player.losses }}</span>
        <span class="s-pins">{{ player.pins }}</span>
        <span class="s-avg">{{ player.avg.toFixed(1) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { aggregateStandings, getSeasons, getDefaultViewSeason, isChampion } from '../utils/data.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()
const router    = useRouter()

const seasons = computed(() => ['all', ...getSeasons(dataStore.stats)])

const activeSeason = computed(() =>
  uiStore.standingsSeason ?? getDefaultViewSeason(dataStore.stats, dataStore.settings)
)

const standings = computed(() => aggregateStandings(dataStore.stats, activeSeason.value))

function goToPlayer(name) {
  router.push({ name: 'player-detail', params: { name } })
}
</script>
