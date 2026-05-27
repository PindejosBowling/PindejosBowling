<template>
  <div v-if="dataStore.loading || !dataStore.stats" class="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading history</div>
  </div>
  <div v-else>
    <div class="tab-title"><h2>Match History</h2></div>
    <div class="filter-bar">
      <select @change="onSeasonChange($event.target.value)">
        <option value="" disabled :selected="!uiStore.histSeason">Select season…</option>
        <option
          v-for="s in seasons"
          :key="s"
          :value="s"
          :selected="s === uiStore.histSeason"
        >Season {{ s }}</option>
      </select>
      <select :disabled="!uiStore.histSeason" @change="uiStore.histWeek = $event.target.value">
        <option value="" disabled :selected="!uiStore.histWeek">Select week…</option>
        <option
          v-for="w in weeks"
          :key="w"
          :value="w"
          :selected="w === uiStore.histWeek"
        >{{ isNaN(parseInt(w)) ? w : 'Week ' + w }}</option>
      </select>
    </div>

    <template v-if="pairings.length">
      <template v-for="gameNum in presentGameNums" :key="gameNum">
        <div class="match-header">
          <div class="match-title">Game {{ gameNum }}</div>
        </div>
        <div
          v-for="(pairing, i) in pairingsByGame[gameNum]"
          :key="i"
          class="matchup"
        >
          <HistoricalTeamBlock
            :team="pairing.a.team"
            :players="pairing.a.players"
            :total="pairing.a.total"
            :winner="pairing.b ? pairing.a.total >= pairing.b.total : true"
          />
          <template v-if="pairing.b">
            <div class="vs-bar">
              <div class="vs-left"></div>
              <div class="vs-chip">VS</div>
              <div class="vs-right"></div>
            </div>
            <HistoricalTeamBlock
              :team="pairing.b.team"
              :players="pairing.b.players"
              :total="pairing.b.total"
              :winner="pairing.b.total > pairing.a.total"
            />
          </template>
        </div>
      </template>
    </template>
    <div v-else-if="uiStore.histSeason && uiStore.histWeek" class="empty-state">
      No data for this week.
    </div>
    <div v-else-if="uiStore.histSeason && !weeks.length" class="empty-state">
      No data for this season.
    </div>
    <div v-else class="empty-state">
      Select a season and week to view match history.
    </div>
  </div>
</template>

<script setup>
import { computed, watchEffect } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { getSeasons, getDefaultViewSeason, getWeeksForSeason, getMatchupsForWeek } from '../utils/data.js'
import HistoricalTeamBlock from '../components/HistoricalTeamBlock.vue'

const dataStore = useDataStore()
const uiStore   = useUiStore()

const seasons = computed(() => getSeasons(dataStore.stats))

const weeks = computed(() =>
  uiStore.histSeason ? getWeeksForSeason(dataStore.stats, uiStore.histSeason) : []
)

// Default to the most recent season and week as soon as data is available.
// Also re-runs when histSeason changes (e.g. onSeasonChange sets histWeek = null)
// so the week always defaults to the last one of the newly selected season.
watchEffect(() => {
  if (!dataStore.stats) return
  if (!uiStore.histSeason) {
    uiStore.histSeason = getDefaultViewSeason(dataStore.stats, dataStore.settings)
  }
  const currentWeeks = getWeeksForSeason(dataStore.stats, uiStore.histSeason)
  if (!uiStore.histWeek || !currentWeeks.includes(uiStore.histWeek)) {
    uiStore.histWeek = currentWeeks[currentWeeks.length - 1] ?? null
  }
})

const pairings = computed(() => {
  if (!uiStore.histSeason || !uiStore.histWeek) return []
  return getMatchupsForWeek(dataStore.stats, uiStore.histSeason, uiStore.histWeek)
})

const presentGameNums = computed(() => [...new Set(pairings.value.map(p => p.gameNum))].sort())

const pairingsByGame = computed(() =>
  Object.fromEntries(
    presentGameNums.value.map(n => [n, pairings.value.filter(p => p.gameNum === n)])
  )
)

function onSeasonChange(season) {
  uiStore.histSeason = season
  uiStore.histWeek   = null
}
</script>
