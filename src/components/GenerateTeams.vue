<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="uiStore.moreView = 'home'">←</button>
    <div class="player-detail-name">Generate Teams</div>
  </div>

  <!-- Controls -->
  <div class="gen-controls">
    <div class="gen-row">
      <div class="gen-label">Number of Teams</div>
      <div class="toggle-group">
        <button
          v-for="n in [2,3,4,5,6]"
          :key="n"
          class="toggle-btn"
          :class="{ active: pendingStore.genNumTeams === n }"
          @click="pendingStore.genNumTeams = n; pendingStore.genTeams = null"
        >{{ n }}</button>
      </div>
    </div>

    <div class="gen-row">
      <div class="gen-label">Players per Team</div>
      <div class="toggle-group">
        <button
          v-for="n in [2,3,4,5]"
          :key="n"
          class="toggle-btn"
          :class="{ active: pendingStore.genTeamSize === n }"
          @click="pendingStore.genTeamSize = n; pendingStore.genTeams = null"
        >{{ n }}</button>
      </div>
    </div>

    <div class="gen-row">
      <div class="gen-label">Avg Source</div>
      <div class="toggle-group">
        <button
          class="toggle-btn"
          :class="{ active: pendingStore.genAvgSource === 'last-season' }"
          @click="pendingStore.genAvgSource = 'last-season'"
        >Last Season</button>
        <button
          class="toggle-btn"
          :class="{ active: pendingStore.genAvgSource === 'current-season' }"
          @click="pendingStore.genAvgSource = 'current-season'"
        >Current</button>
        <button
          class="toggle-btn"
          :class="{ active: pendingStore.genAvgSource === 'all-time' }"
          @click="pendingStore.genAvgSource = 'all-time'"
        >All-time</button>
      </div>
    </div>

    <div class="gen-row">
      <div class="gen-label">Fill MIA Players With</div>
      <div class="toggle-group">
        <button
          class="toggle-btn"
          :class="{ active: pendingStore.genFillMode === 'League Avg' }"
          @click="pendingStore.genFillMode = 'League Avg'"
        >League Avg</button>
        <button
          class="toggle-btn"
          :class="{ active: pendingStore.genFillMode === 'Their Avg' }"
          @click="pendingStore.genFillMode = 'Their Avg'"
        >Their Avg</button>
      </div>
    </div>

    <div class="gen-row">
      <label style="display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer;background:var(--surface2);border-radius:10px;">
        <input
          type="checkbox"
          :checked="pendingStore.genFillToSize"
          @change="pendingStore.genFillToSize = $event.target.checked"
          style="width:18px;height:18px;accent-color:var(--accent);"
        />
        <span style="font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:13px;">
          Pad short teams with league avg placeholders
        </span>
      </label>
    </div>

    <div style="font-size:12px;color:var(--muted);padding:6px 0;line-height:1.5;">
      Need <strong style="color:var(--accent);">{{ requiredCount }}</strong> players ·
      <strong :style="{ color: availCount >= requiredCount ? 'var(--success)' : 'var(--danger)' }">
        {{ availCount }} available
      </strong>
      <span v-if="availCount < requiredCount && !pendingStore.genFillToSize" style="color:var(--danger);">
        · Short {{ requiredCount - availCount }}
      </span>
    </div>

    <button class="btn primary" :disabled="generating" @click="doGenerate()">
      <span v-if="generating" class="spinner"></span>
      {{ generating ? 'Generating…' : 'Generate' }}
    </button>
  </div>

  <!-- Generated teams -->
  <template v-if="pendingStore.genTeams">
    <div class="section-header">
      Generated Teams
      <div class="actions">
        <span class="right-text">
          {{ pendingStore.genSwapTarget ? 'Tap a player to swap' : 'Tap "Swap" to start' }}
        </span>
      </div>
    </div>

    <div
      v-for="(team, tIdx) in pendingStore.genTeams"
      :key="tIdx"
      class="team-preview-card"
    >
      <div class="tp-head">
        <div class="tp-name">Team {{ tIdx + 1 }}</div>
        <div class="tp-total">{{ teamTotal(team) }}</div>
      </div>
      <div class="tp-list">
        <div
          v-for="(player, pIdx) in team.players"
          :key="pIdx"
          class="tp-row"
        >
          <div
            class="tp-player"
            :class="{ unavail: player.status === 'Unavailable' }"
          >
            <template v-if="isFill(player)">
              <span style="color:var(--muted);font-style:italic;">League Avg Fill</span>
            </template>
            <template v-else>
              <span>{{ player.name }}</span>
              <span v-if="isChampion(dataStore.champions, player.name)" class="champ-crown">👑</span>
            </template>
            <span v-if="player.status === 'Unavailable'" class="absent-tag">OUT</span>
            <span v-if="isFill(player)" class="fill-tag">FILL</span>
          </div>
          <div class="tp-avg">{{ player.avg.toFixed(1) }}</div>
          <button
            v-if="!isFill(player)"
            class="swap-btn"
            :class="{ selected: isSwapTarget(tIdx, pIdx) }"
            @click="handleSwap(tIdx, pIdx)"
          >{{ isSwapTarget(tIdx, pIdx) ? 'Pick swap' : 'Swap' }}</button>
        </div>
      </div>
    </div>

    <button
      class="btn primary"
      style="margin-top:12px;"
      :disabled="confirming"
      @click="useTeams()"
    >{{ confirming ? 'Saving…' : 'Use These Teams' }}</button>
  </template>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDataStore }    from '../stores/data.js'
import { useUiStore }      from '../stores/ui.js'
import { usePendingStore } from '../stores/pending.js'
import { isChampion }      from '../utils/data.js'
import { apiGet, apiPost } from '../api.js'

const dataStore    = useDataStore()
const uiStore      = useUiStore()
const pendingStore = usePendingStore()

const generating = ref(false)
const confirming = ref(false)

const availCount = computed(() =>
  (dataStore.roster ?? []).slice(1).filter(r => r[0] && r[1] === 'Available').length
)
const requiredCount = computed(() =>
  pendingStore.genNumTeams * pendingStore.genTeamSize
)

function isFill(player) {
  return player.isFill || player.status === 'Fill'
}

function isSwapTarget(tIdx, pIdx) {
  return pendingStore.genSwapTarget?.team === tIdx && pendingStore.genSwapTarget?.idx === pIdx
}

function teamTotal(team) {
  return Math.round(team.players.reduce((s, p) => s + p.avg, 0))
}

async function doGenerate() {
  generating.value = true
  // Refresh roster so latest RSVPs are reflected
  try {
    const fresh = await apiGet('getRoster')
    if (Array.isArray(fresh)) dataStore.roster = fresh
  } catch (e) { /* non-fatal, fall through */ }

  try {
    const r = await apiPost('generateTeams', {
      fillMode:   pendingStore.genFillMode,
      avgSource:  pendingStore.genAvgSource,
      numTeams:   pendingStore.genNumTeams,
      teamSize:   pendingStore.genTeamSize,
      fillToSize: pendingStore.genFillToSize,
    })
    if (!r || r.error || !Array.isArray(r.teams)) {
      console.error('generateTeams error:', r)
    } else {
      pendingStore.genTeams = r.teams
      pendingStore.genSwapTarget = null
    }
  } catch (e) {
    console.error('generateTeams network error:', e)
  } finally {
    generating.value = false
  }
}

function handleSwap(tIdx, pIdx) {
  const target = pendingStore.genSwapTarget
  if (!target) {
    pendingStore.genSwapTarget = { team: tIdx, idx: pIdx }
  } else if (target.team === tIdx && target.idx === pIdx) {
    // Tap same player — cancel swap
    pendingStore.genSwapTarget = null
  } else {
    // Perform swap — deep clone to ensure Vue reactivity
    const teams = JSON.parse(JSON.stringify(pendingStore.genTeams))
    const a = teams[target.team].players[target.idx]
    const b = teams[tIdx].players[pIdx]
    teams[target.team].players[target.idx] = b
    teams[tIdx].players[pIdx] = a
    pendingStore.genTeams = teams
    pendingStore.genSwapTarget = null
  }
}

async function useTeams() {
  if (!pendingStore.genTeams) return
  confirming.value = true
  try {
    await apiPost('confirmMatchups', {
      teams:     pendingStore.genTeams.map(t => t.players),
      avgSource: pendingStore.genAvgSource,
    })
    await dataStore.loadAll()
    pendingStore.genTeams = null
    pendingStore.genSwapTarget = null
    uiStore.moreView = 'home'
    window.switchTab('matchups')
  } catch (e) {
    console.error('confirmMatchups error:', e)
  } finally {
    confirming.value = false
  }
}
</script>
