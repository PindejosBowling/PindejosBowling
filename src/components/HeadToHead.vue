<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="uiStore.moreView = 'home'">←</button>
    <div class="player-detail-name">Head to Head</div>
  </div>

  <div class="h2h-controls">
    <select :value="uiStore.h2hP1" @change="uiStore.h2hP1 = $event.target.value">
      <option value="">— Bowler 1 —</option>
      <option v-for="name in allPlayerNames" :key="name" :value="name">{{ name }}</option>
    </select>
    <span class="h2h-vs">VS</span>
    <select :value="uiStore.h2hP2" @change="uiStore.h2hP2 = $event.target.value">
      <option value="">— Bowler 2 —</option>
      <option v-for="name in allPlayerNames" :key="name" :value="name">{{ name }}</option>
    </select>
  </div>

  <!-- No selection yet -->
  <div v-if="!uiStore.h2hP1 || !uiStore.h2hP2 || uiStore.h2hP1 === uiStore.h2hP2" class="empty-state">
    <div class="empty-state-icon">⚔️</div>
    Pick two different bowlers to compare.
  </div>

  <template v-else-if="h2hData">
    <!-- No shared games -->
    <div v-if="!h2hData.games.length" class="empty-state">
      These two have never played head-to-head.
    </div>

    <template v-else>
      <!-- Summary card -->
      <div class="h2h-result">
        <div class="h2h-head">
          <div class="h2h-name" :class="{ lead: teamLead === 'p1' }">{{ uiStore.h2hP1 }}</div>
          <div class="h2h-divider">vs</div>
          <div class="h2h-name" :class="{ lead: teamLead === 'p2' }">{{ uiStore.h2hP2 }}</div>
        </div>
        <div class="h2h-stat-row">
          <div class="h2h-stat-label">Team Wins</div>
          <div class="h2h-stat-line">
            <span class="h2h-stat-num" :class="{ lead: teamLead === 'p1' }">{{ h2hData.teamP1Wins }}</span>
            <span class="h2h-stat-dash">—</span>
            <span class="h2h-stat-num" :class="{ lead: teamLead === 'p2' }">{{ h2hData.teamP2Wins }}</span>
          </div>
          <div v-if="h2hData.teamTies" class="h2h-stat-sub">
            {{ h2hData.teamTies }} tie{{ h2hData.teamTies > 1 ? 's' : '' }}
          </div>
        </div>
        <div class="h2h-stat-row">
          <div class="h2h-stat-label">Pin Total Wins</div>
          <div class="h2h-stat-line">
            <span class="h2h-stat-num" :class="{ lead: pinLead === 'p1' }">{{ h2hData.pinP1Wins }}</span>
            <span class="h2h-stat-dash">—</span>
            <span class="h2h-stat-num" :class="{ lead: pinLead === 'p2' }">{{ h2hData.pinP2Wins }}</span>
          </div>
          <div v-if="h2hData.pinTies" class="h2h-stat-sub">
            {{ h2hData.pinTies }} tie{{ h2hData.pinTies > 1 ? 's' : '' }}
          </div>
        </div>
      </div>

      <!-- Game log -->
      <div class="section-header">Every Matchup</div>
      <div class="score-history-table">
        <div
          class="score-history-row head"
          style="grid-template-columns: 60px 1fr 1fr 50px 50px;"
        >
          <span>When</span>
          <span>{{ uiStore.h2hP1 }} pins</span>
          <span>{{ uiStore.h2hP2 }} pins</span>
          <span>Team Δ</span>
          <span>Win</span>
        </div>
        <div
          v-for="(g, i) in reversedGames"
          :key="i"
          class="score-history-row"
          style="grid-template-columns: 60px 1fr 1fr 50px 50px;"
        >
          <span class="sh-week">S{{ g.season }}W{{ g.week }}.G{{ g.gameNum }}</span>
          <span :style="{ color: g.p1Score > g.p2Score ? 'var(--accent)' : 'var(--text)' }">
            {{ g.p1Score }}
          </span>
          <span :style="{ color: g.p2Score > g.p1Score ? 'var(--accent)' : 'var(--text)' }">
            {{ g.p2Score }}
          </span>
          <span :style="{ color: teamDiff(g) >= 0 ? 'var(--success)' : 'var(--danger)' }">
            {{ teamDiff(g) > 0 ? '+' : '' }}{{ teamDiff(g) }}
          </span>
          <span style="font-size:10px; color:var(--muted)">{{ gameWinner(g) }}</span>
        </div>
      </div>
    </template>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { aggregateStandings, getH2H } from '../utils/data.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()

const allPlayerNames = computed(() => {
  if (!dataStore.stats) return []
  return aggregateStandings(dataStore.stats, 'all').map(p => p.name)
})

const h2hData = computed(() => {
  if (!uiStore.h2hP1 || !uiStore.h2hP2) return null
  return getH2H(dataStore.stats, uiStore.h2hP1, uiStore.h2hP2)
})

const teamLead = computed(() => {
  if (!h2hData.value) return null
  const { teamP1Wins, teamP2Wins } = h2hData.value
  return teamP1Wins > teamP2Wins ? 'p1' : teamP2Wins > teamP1Wins ? 'p2' : 'tie'
})

const pinLead = computed(() => {
  if (!h2hData.value) return null
  const { pinP1Wins, pinP2Wins } = h2hData.value
  return pinP1Wins > pinP2Wins ? 'p1' : pinP2Wins > pinP1Wins ? 'p2' : 'tie'
})

const reversedGames = computed(() =>
  h2hData.value ? h2hData.value.games.slice().reverse() : []
)

function teamDiff(g) {
  return g.t1Total - g.t2Total
}

function gameWinner(g) {
  const diff = teamDiff(g)
  if (diff === 0) return '—'
  return diff > 0 ? 'P1' : 'P2'
}
</script>
