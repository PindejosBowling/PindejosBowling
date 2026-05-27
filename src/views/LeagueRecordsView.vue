<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="router.push('/more')">←</button>
    <div class="player-detail-name">League Records</div>
  </div>

  <div class="filter-bar">
    <select :value="uiStore.recordsSeason" @change="uiStore.recordsSeason = $event.target.value">
      <option value="all">All-time</option>
      <option v-for="s in seasons" :key="s" :value="s">Season {{ s }}</option>
    </select>
  </div>

  <!-- High Single Game -->
  <div class="card-md record-card">
    <div class="record-card-head">
      <div class="icon-box lg">🎳</div>
      <div class="record-info">
        <div class="label-sm">High Single Game</div>
        <template v-if="records.highGame.val">
          <div class="record-value">{{ records.highGame.by }}</div>
          <div class="record-detail">{{ records.highGame.when }}</div>
        </template>
        <div v-else class="record-value" style="color:var(--muted)">No record yet</div>
      </div>
      <div v-if="records.highGame.val" class="record-num">{{ records.highGame.val }}</div>
    </div>
  </div>

  <!-- High Series -->
  <div class="card-md record-card">
    <div class="record-card-head">
      <div class="icon-box lg">📈</div>
      <div class="record-info">
        <div class="label-sm">High Series (G1+G2)</div>
        <template v-if="records.highSeries.val">
          <div class="record-value">{{ records.highSeries.by }}</div>
          <div class="record-detail">{{ records.highSeries.when }}</div>
        </template>
        <div v-else class="record-value" style="color:var(--muted)">No record yet</div>
      </div>
      <div v-if="records.highSeries.val" class="record-num">{{ records.highSeries.val }}</div>
    </div>
  </div>

  <!-- High Team Game -->
  <div class="card-md record-card">
    <div class="record-card-head">
      <div class="icon-box lg">💪</div>
      <div class="record-info">
        <div class="label-sm">High Team Game</div>
        <template v-if="records.highTeamGame.val">
          <div class="record-value">{{ records.highTeamGame.team }}</div>
          <div class="record-detail">{{ records.highTeamGame.when }}</div>
        </template>
        <div v-else class="record-value" style="color:var(--muted)">No record yet</div>
      </div>
      <div v-if="records.highTeamGame.val" class="record-num">{{ records.highTeamGame.val }}</div>
    </div>
    <div v-if="records.highTeamGame.roster?.length" class="record-team-roster">
      <div
        v-for="p in records.highTeamGame.roster"
        :key="p.name"
        class="record-team-row"
      >
        <span class="name">{{ p.name }}</span>
        <span class="score">{{ p.score }}</span>
      </div>
    </div>
  </div>

  <!-- High Team Night -->
  <div class="card-md record-card">
    <div class="record-card-head">
      <div class="icon-box lg">🌙</div>
      <div class="record-info">
        <div class="label-sm">High Team Night</div>
        <template v-if="records.highTeamNight.val">
          <div class="record-value">{{ records.highTeamNight.team }}</div>
          <div class="record-detail">{{ records.highTeamNight.when }}</div>
        </template>
        <div v-else class="record-value" style="color:var(--muted)">No record yet</div>
      </div>
      <div v-if="records.highTeamNight.val" class="record-num">{{ records.highTeamNight.val }}</div>
    </div>
    <div v-if="records.highTeamNight.val" class="record-team-roster">
      <div v-if="records.highTeamNight.g1Roster?.length" class="record-team-game">
        <div class="record-team-game-head">
          <span class="record-team-game-title">Game 1</span>
          <span class="record-team-game-total">{{ records.highTeamNight.g1Total }}</span>
        </div>
        <div
          v-for="p in records.highTeamNight.g1Roster"
          :key="'g1-' + p.name"
          class="record-team-row"
        >
          <span class="name">{{ p.name }}</span>
          <span class="score">{{ p.score }}</span>
        </div>
      </div>
      <div v-if="records.highTeamNight.g2Roster?.length" class="record-team-game">
        <div class="record-team-game-head">
          <span class="record-team-game-title">Game 2</span>
          <span class="record-team-game-total">{{ records.highTeamNight.g2Total }}</span>
        </div>
        <div
          v-for="p in records.highTeamNight.g2Roster"
          :key="'g2-' + p.name"
          class="record-team-row"
        >
          <span class="name">{{ p.name }}</span>
          <span class="score">{{ p.score }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Best Season Avg -->
  <div class="card-md record-card">
    <div class="record-card-head">
      <div class="icon-box lg">🏆</div>
      <div class="record-info">
        <div class="label-sm">Best Season Avg</div>
        <template v-if="records.bestSeasonAvg.val">
          <div class="record-value">{{ records.bestSeasonAvg.by }}</div>
          <div class="record-detail">{{ records.bestSeasonAvg.when }}</div>
        </template>
        <div v-else class="record-value" style="color:var(--muted)">No record yet</div>
      </div>
      <div v-if="records.bestSeasonAvg.val" class="record-num">
        {{ records.bestSeasonAvg.val.toFixed(1) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { getLeagueRecords, getSeasons } from '../utils/data.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()
const router    = useRouter()

const seasons = computed(() => getSeasons(dataStore.stats))

const records = computed(() => getLeagueRecords(dataStore.stats, uiStore.recordsSeason))
</script>
