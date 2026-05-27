<template>
  <!-- Header -->
  <div class="player-detail-header">
    <button class="back-btn" @click="router.push('/more/players')">←</button>
    <div>
      <div class="player-detail-name">
        {{ route.params.name }}
        <span v-if="isChampion(dataStore.champions, route.params.name)" class="champ-crown">👑</span>
      </div>
      <div v-if="currentTeam" class="player-detail-team">{{ currentTeam }}</div>
    </div>
  </div>

  <!-- Season filter -->
  <div class="filter-bar">
    <select :value="activeSeason" @change="uiStore.playerSeason = $event.target.value">
      <option value="all">All-time</option>
      <option v-for="s in seasons" :key="s" :value="String(s)">Season {{ s }}</option>
    </select>
  </div>

  <!-- Stat tiles -->
  <div v-if="profile" class="stat-grid">
    <div class="stat-tile">
      <div class="stat-tile-label">Avg</div>
      <div class="stat-tile-val">{{ profile.avg > 0 ? profile.avg.toFixed(1) : '—' }}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">High Game</div>
      <div class="stat-tile-val">{{ profile.highGame || '—' }}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">W—L</div>
      <div class="stat-tile-val">{{ profile.totalWins }}–{{ profile.totalLosses }}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Last 5 Avg</div>
      <div class="stat-tile-val">{{ profile.last5Avg > 0 ? profile.last5Avg.toFixed(1) : '—' }}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Season Avg</div>
      <div class="stat-tile-val">{{ profile.seasonAvg > 0 ? profile.seasonAvg.toFixed(1) : '—' }}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Games</div>
      <div class="stat-tile-val">{{ profile.totalGames }}</div>
    </div>
  </div>

  <!-- Personal records -->
  <template v-if="records">
    <div class="section-header">Personal Records</div>
    <div class="record-card">
      <div class="record-card-head">
        <div class="record-icon">🎳</div>
        <div class="record-info">
          <div class="record-label">High Game</div>
          <div class="record-value">{{ records.highGame || '—' }}</div>
        </div>
      </div>
    </div>
    <div class="record-card">
      <div class="record-card-head">
        <div class="record-icon">📈</div>
        <div class="record-info">
          <div class="record-label">High Series (G1+G2)</div>
          <div class="record-value">{{ records.highSeries || '—' }}</div>
        </div>
      </div>
    </div>
    <div class="record-card">
      <div class="record-card-head">
        <div class="record-icon">🔥</div>
        <div class="record-info">
          <div class="record-label">Best Streak</div>
          <div class="record-value">
            {{ records.bestStreak }} {{ records.bestStreak === 1 ? 'night' : 'nights' }}
          </div>
          <div v-if="records.currentStreak > 0" class="record-detail">
            Current: {{ records.currentStreak }}
            {{ records.currentStreakType === 'W' ? 'win' : 'loss' }}{{ records.currentStreak > 1 ? (records.currentStreakType === 'W' ? 's' : 'es') : '' }}
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- Chart -->
  <div v-if="profile && profile.games.length" class="chart-card">
    <div class="chart-title">Score Trend</div>
    <div class="chart-wrap">
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>

  <!-- Game log toggle -->
  <div class="section-header">
    Game Log
    <div class="actions">
      <div class="toggle-group" style="padding:2px;">
        <button
          class="toggle-btn"
          :class="{ active: uiStore.playerLogMode === 'bowled' }"
          @click="uiStore.playerLogMode = 'bowled'"
          style="font-size:10px;padding:5px 8px;"
        >Bowled</button>
        <button
          class="toggle-btn"
          :class="{ active: uiStore.playerLogMode === 'all' }"
          @click="uiStore.playerLogMode = 'all'"
          style="font-size:10px;padding:5px 8px;"
        >All Weeks</button>
      </div>
    </div>
  </div>

  <!-- Game log table -->
  <div v-if="weekRows.length" class="score-history-table">
    <div class="score-history-row head week-grouped">
      <span>Week</span><span>Team</span><span>G1</span><span>G2</span><span>W—L</span><span></span>
    </div>
    <template v-for="row in weekRows" :key="row.season + '|' + row.week">
      <div
        class="score-history-row clickable week-grouped"
        @click="toggleWeek(row.season + '|' + row.week)"
      >
        <span class="sh-week">{{ weekLabel(row) }}</span>
        <span class="sh-team">{{ row.team || '' }}</span>
        <template v-if="!row.present">
          <span class="sh-out" style="grid-column: 3 / 6;">absent</span>
        </template>
        <template v-else>
          <span :style="{ color: row.g1 ? 'var(--accent)' : 'var(--muted)' }">{{ row.g1 || '—' }}</span>
          <span :style="{ color: row.g2 ? 'var(--accent)' : 'var(--muted)' }">{{ row.g2 || '—' }}</span>
          <span class="sh-record" :class="{ win: row.w > row.l, loss: row.l > row.w }">
            {{ (row.w || row.l) ? `${row.w}—${row.l}` : '—' }}
          </span>
        </template>
        <span class="sh-expand-icon">
          {{ uiStore.expandedWeek === (row.season + '|' + row.week) ? '▾' : '▸' }}
        </span>
      </div>

      <!-- Expanded week matchup detail -->
      <div
        v-if="uiStore.expandedWeek === (row.season + '|' + row.week)"
        class="week-expand"
      >
        <div class="week-expand-inner">
          <template v-if="expandedMatchups(row).length">
            <template v-for="m in expandedMatchups(row)" :key="`${m.gameNum}-${m.a?.team}`">
              <div class="match-header" style="margin:8px 0;">
                <div class="match-title" style="font-size:16px;">Game {{ m.gameNum }}</div>
              </div>
              <div class="matchup">
                <div class="vs-bar">
                  <div class="vs-left">
                    <div class="team-block">
                      <div class="team-label">{{ m.a?.team }}</div>
                      <div
                        v-for="p in m.a?.players"
                        :key="p.name"
                        class="player-row"
                        :class="{ absent: !p.present }"
                      >
                        <div class="player-avatar">{{ initials(p.name) }}</div>
                        <div class="player-name">
                          {{ p.name }}
                          <span v-if="!p.present" class="absent-tag">absent</span>
                        </div>
                        <div>{{ p.score || '—' }}</div>
                      </div>
                      <div class="team-total-row">
                        <span class="total-label">Total</span>
                        <span class="total-val">{{ m.a?.total }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="vs-chip">VS</div>
                  <div v-if="m.b" class="vs-right">
                    <div class="team-block">
                      <div class="team-label">{{ m.b.team }}</div>
                      <div
                        v-for="p in m.b.players"
                        :key="p.name"
                        class="player-row"
                        :class="{ absent: !p.present }"
                      >
                        <div class="player-avatar">{{ initials(p.name) }}</div>
                        <div class="player-name">
                          {{ p.name }}
                          <span v-if="!p.present" class="absent-tag">absent</span>
                        </div>
                        <div>{{ p.score || '—' }}</div>
                      </div>
                      <div class="team-total-row">
                        <span class="total-label">Total</span>
                        <span class="total-val">{{ m.b.total }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </template>
          <div v-else class="empty-state" style="padding:16px;">No matchup data for this week.</div>
        </div>
      </div>
    </template>
  </div>
  <div v-else-if="profile" class="empty-state">No games yet.</div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Chart from 'chart.js/auto'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import {
  getPlayerProfile, getPersonalRecords, isChampion,
  getSeasons, getMatchupsForWeek,
} from '../utils/data.js'
import { initials, isPresent } from '../utils/helpers.js'
import { SC } from '../utils/constants.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()
const route     = useRoute()
const router    = useRouter()

const chartCanvas = ref(null)

// ── Computed ────────────────────────────────────────────────────────────────

const seasons = computed(() => getSeasons(dataStore.stats))

// null playerSeason → 'all' (show everything by default)
const activeSeason = computed(() => uiStore.playerSeason ?? 'all')

const profile = computed(() =>
  route.params.name
    ? getPlayerProfile(dataStore.stats, dataStore.settings, route.params.name, activeSeason.value)
    : null
)

const records = computed(() =>
  route.params.name
    ? getPersonalRecords(dataStore.stats, route.params.name)
    : null
)

// Most-recent team for the player in the current season filter
const currentTeam = computed(() => {
  const rows = profile.value?.rows
  if (!rows?.length) return null
  return rows[rows.length - 1][SC.TEAM] || null
})

// Week-grouped rows for the game log
const weekRows = computed(() => {
  const rows = profile.value?.rows
  if (!rows) return []
  const logMode = uiStore.playerLogMode
  const result = []
  rows.forEach(r => {
    const present = isPresent(r[SC.PRESENT])
    if (logMode === 'bowled' && !present) return
    result.push({
      season:  r[SC.SEASON],
      week:    r[SC.WEEK],
      team:    r[SC.TEAM],
      g1:      parseInt(r[SC.G1])     || 0,
      g2:      parseInt(r[SC.G2])     || 0,
      w:       parseInt(r[SC.WINS])   || 0,
      l:       parseInt(r[SC.LOSSES]) || 0,
      present,
    })
  })
  // Newest first
  return result.sort((a, b) => {
    const sa = parseInt(a.season) || 0, sb = parseInt(b.season) || 0
    if (sa !== sb) return sb - sa
    return (parseInt(b.week) || 0) - (parseInt(a.week) || 0)
  })
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function weekLabel(row) {
  return isNaN(parseInt(row.week)) ? row.week : `S${row.season}W${row.week}`
}

function toggleWeek(key) {
  uiStore.expandedWeek = uiStore.expandedWeek === key ? null : key
}

/** Return the matchups for the expanded row, filtered to the player's team. */
function expandedMatchups(row) {
  const all  = getMatchupsForWeek(dataStore.stats, row.season, row.week)
  const team = row.team
  if (!team) return all
  const mine = all.filter(m => m.a?.team === team || m.b?.team === team)
  return mine.length ? mine : all
}

// ── Chart ───────────────────────────────────────────────────────────────────

watchEffect((onCleanup) => {
  if (!chartCanvas.value || !profile.value?.games?.length) return

  const games  = profile.value.games
  const labels = games.map(g => `S${g.season}W${g.week}.G${g.gameNum}`)
  const data   = games.map(g => g.score)
  const avg    = profile.value.avg

  const chart = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Score',
          data,
          borderColor: '#e8ff47',
          backgroundColor: 'rgba(232,255,71,0.15)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#e8ff47',
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Avg',
          data: data.map(() => avg),
          borderColor: 'rgba(255,79,109,0.5)',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1c1c21', borderColor: '#25252b', borderWidth: 1 },
      },
      scales: {
        y: {
          grid:  { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7a7a85', font: { size: 10 } },
        },
        x: {
          grid:  { display: false },
          ticks: { color: '#7a7a85', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
      },
    },
  })

  onCleanup(() => chart.destroy())
})
</script>
