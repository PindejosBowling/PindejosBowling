<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="router.push('/more')">←</button>
    <div class="player-detail-name">Players</div>
  </div>
  <input
    class="player-search"
    v-model="search"
    placeholder="Search players…"
    type="text"
  />
  <div>
    <div
      v-for="player in filteredPlayers"
      :key="player.name"
      class="card-md player-card"
      @click="select(player.name)"
    >
      <div class="icon-box md player-avatar" :class="{ champ: isChampion(dataStore.champions, player.name) }">
        {{ initials(player.name) }}
      </div>
      <div class="player-card-info">
        <div class="player-card-name">
          {{ player.name }}
          <span v-if="isChampion(dataStore.champions, player.name)" class="champ-crown">👑</span>
        </div>
        <div class="player-card-stats">{{ player.wins }}W {{ player.losses }}L</div>
      </div>
      <div class="player-card-avg">{{ player.avg > 0 ? player.avg.toFixed(1) : '—' }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data.js'
import { aggregateStandings, isChampion } from '../utils/data.js'
import { initials } from '../utils/helpers.js'

const dataStore = useDataStore()
const router    = useRouter()

const search = ref('')

const allPlayers = computed(() => {
  if (!dataStore.stats) return []
  return aggregateStandings(dataStore.stats, 'all')
    .map(p => ({ name: p.name, avg: p.avg, wins: p.wins, losses: p.losses }))
})

const filteredPlayers = computed(() =>
  allPlayers.value.filter(p =>
    p.name.toLowerCase().includes(search.value.toLowerCase())
  )
)

function select(name) {
  router.push({ name: 'player-detail', params: { name } })
}
</script>
