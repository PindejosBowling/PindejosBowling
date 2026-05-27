<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="router.push('/more')">←</button>
    <div class="player-detail-name">Past Seasons</div>
  </div>

  <div v-if="!seasonData.length" class="empty-state">No completed seasons yet.</div>

  <div v-for="item in seasonData" :key="item.season" class="card history-season">
    <div class="history-head">
      <div class="history-season-name">Season {{ item.season }}</div>
      <div v-if="item.champs.length" class="history-champion">
        👑 {{ item.champs.join(', ') }}
      </div>
    </div>
    <div class="history-body">
      <div v-if="item.notes" class="season-blurb">{{ item.notes }}</div>
      <div class="history-stat">
        <span class="history-stat-label">Top Bowler</span>
        <span class="history-stat-val">
          {{ item.top ? `${item.top.name} (${item.top.avg.toFixed(1)})` : '—' }}
        </span>
      </div>
      <div class="history-stat">
        <span class="history-stat-label">League Avg</span>
        <span class="history-stat-val">{{ item.leagueAvg.toFixed(1) }}</span>
      </div>
      <div class="history-stat">
        <span class="history-stat-label">Bowlers</span>
        <span class="history-stat-val">{{ item.playerCount }}</span>
      </div>
      <div class="history-stat">
        <span class="history-stat-label">Weeks</span>
        <span class="history-stat-val">{{ item.weeks }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data.js'
import { aggregateStandings, getSeasons, getWeeksForSeason, championsForSeason } from '../utils/data.js'

const dataStore = useDataStore()
const router    = useRouter()

/** Build a notes lookup map from the League History sheet keyed by season number string. */
const notesMap = computed(() => {
  const map = {}
  if (!dataStore.history || dataStore.history.length < 2) return map
  const headers = dataStore.history[0].map(h => String(h).toLowerCase())
  const seasonCol = headers.indexOf('season') !== -1 ? headers.indexOf('season') : 0
  const notesCol  = headers.indexOf('notes')
  if (notesCol === -1) return map
  for (let i = 1; i < dataStore.history.length; i++) {
    const cell = String(dataStore.history[i][seasonCol] || '').trim()
    const key  = cell.replace(/season\s*/i, '').trim()
    if (key && dataStore.history[i][notesCol]) map[key] = dataStore.history[i][notesCol]
  }
  return map
})

const seasonData = computed(() => {
  if (!dataStore.stats) return []
  return getSeasons(dataStore.stats)
    .slice()
    .sort((a, b) => parseInt(b) - parseInt(a))
    .map(s => {
      const standings  = aggregateStandings(dataStore.stats, s)
      const top        = standings[0] ?? null
      const champs     = championsForSeason(dataStore.champions, s)
      const weeks      = getWeeksForSeason(dataStore.stats, s).length
      const totalPins  = standings.reduce((sum, p) => sum + p.pins, 0)
      const totalGames = standings.reduce((sum, p) => sum + p.games, 0)
      const leagueAvg  = totalGames ? totalPins / totalGames : 0
      const notes      = notesMap.value[String(s)] || ''
      return { season: s, top, champs, playerCount: standings.length, weeks, leagueAvg, notes }
    })
})
</script>
