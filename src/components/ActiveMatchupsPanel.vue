<template>
  <div>
    <!-- Tab title + view toggle -->
    <div class="tab-title">
      <h2>Matchups</h2>
      <span class="pill">This Week</span>
      <select class="view-flip" :value="uiStore.matchupsView" @change="uiStore.matchupsView = $event.target.value">
        <option value="scores">Live</option>
        <option value="expected">Expected</option>
      </select>
    </div>

    <!-- League avg banner -->
    <div class="league-avg-banner">
      <div class="league-avg-info">
        <div class="league-avg-label">League {{ sourceLabel }}</div>
        <div class="league-avg-val">{{ leagueAvg > 0 ? leagueAvg.toFixed(1) : '—' }}</div>
      </div>
      <select class="avg-source-select" :value="prefsStore.avgDisplay" @change="prefsStore.avgDisplay = $event.target.value">
        <option value="last-played">Last Season</option>
        <option value="current-season">This Season</option>
        <option value="all-time">All-time</option>
      </select>
    </div>

    <!-- Game rounds -->
    <template v-for="round in rounds" :key="round.num">
      <div class="match-header">
        <div class="match-title">Game {{ round.num }}</div>
      </div>

      <template v-for="(pairing, pi) in round.pairings" :key="pi">
        <!-- Team sits out (no opponent for this round) -->
        <div v-if="!pairing.b" class="card matchup">
          <div class="team-block">
            <div class="label team-label">{{ pairing.a.name }}</div>
            <PlayerScoreRow
              v-for="player in pairing.a.players"
              :key="player.slot"
              :player="player"
              :team-name="pairing.a.name"
              :game-num="round.num"
              :mode="uiStore.matchupsView"
              :league-avg="leagueAvg"
            />
          </div>
          <div style="padding:10px 16px;color:var(--muted);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;text-align:center;font-family:'Barlow Condensed',sans-serif;">— sits out —</div>
        </div>

        <!-- Normal matchup -->
        <div v-else class="card matchup">
          <!-- Team A -->
          <div class="team-block" :class="{ winner: aWins(pairing, round.num) }">
            <div class="label team-label" :class="{ winner: aWins(pairing, round.num) }">{{ pairing.a.name }}</div>
            <PlayerScoreRow
              v-for="player in pairing.a.players"
              :key="player.slot"
              :player="player"
              :team-name="pairing.a.name"
              :game-num="round.num"
              :mode="uiStore.matchupsView"
              :league-avg="leagueAvg"
            />
            <!-- Total row -->
            <div v-if="uiStore.matchupsView === 'expected'" class="team-total-row">
              <span class="total-label">Expected total</span>
              <div class="total-meta"><span class="total-val total-losing">{{ expectedTotal(pairing.a) }}</span></div>
            </div>
            <div v-else-if="getTotal(pairing.a.name, round.num) > 0" class="team-total-row">
              <span class="total-label">Team total</span>
              <div class="total-meta">
                <span class="total-val" :class="aWins(pairing, round.num) ? 'total-winning' : 'total-losing'">
                  {{ getTotal(pairing.a.name, round.num) }}
                </span>
              </div>
            </div>
          </div>

          <div class="vs-bar">
            <div class="vs-left"></div>
            <div class="vs-chip">VS</div>
            <div class="vs-right"></div>
          </div>

          <!-- Team B -->
          <div class="team-block" :class="{ winner: bWins(pairing, round.num) }">
            <div class="label team-label" :class="{ winner: bWins(pairing, round.num) }">{{ pairing.b.name }}</div>
            <PlayerScoreRow
              v-for="player in pairing.b.players"
              :key="player.slot"
              :player="player"
              :team-name="pairing.b.name"
              :game-num="round.num"
              :mode="uiStore.matchupsView"
              :league-avg="leagueAvg"
            />
            <!-- Total row -->
            <div v-if="uiStore.matchupsView === 'expected'" class="team-total-row">
              <span class="total-label">Expected total</span>
              <div class="total-meta"><span class="total-val total-losing">{{ expectedTotal(pairing.b) }}</span></div>
            </div>
            <div v-else-if="getTotal(pairing.b.name, round.num) > 0" class="team-total-row">
              <span class="total-label">Team total</span>
              <div class="total-meta">
                <span class="total-val" :class="bWins(pairing, round.num) ? 'total-winning' : 'total-losing'">
                  {{ getTotal(pairing.b.name, round.num) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Odds easter egg (expected mode only) -->
    <template v-if="uiStore.matchupsView === 'expected'">
      <div class="odds-toggle">
        <span class="odds-toggle-link" @click="uiStore.oddsRevealed = !uiStore.oddsRevealed">
          {{ uiStore.oddsRevealed ? '· hide odds ·' : '· · ·' }}
        </span>
      </div>
      <div v-if="uiStore.oddsRevealed" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-top:8px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--accent2);margin-bottom:10px;">
          Tonight's Lines
        </div>
        <template v-for="round in rounds" :key="round.num">
          <template v-for="(pairing, pi) in round.pairings" :key="pi">
            <OddsBlock
              v-if="pairing.b"
              :team-a="pairing.a"
              :team-b="pairing.b"
              :league-avg="leagueAvg"
              :label="`Game ${round.num} · ${pairing.a.name} vs ${pairing.b.name}`"
            />
          </template>
        </template>
        <div style="font-size:10px;color:var(--muted2);margin-top:10px;font-style:italic;">
          For entertainment only. Lines are made up.
        </div>
      </div>
    </template>

    <!-- Floating confirm bar for pending scores -->
    <div v-if="hasPendingScores" class="confirm-bar floating" :class="{ saving }">
      <template v-if="saving">
        <div class="confirm-bar-text">
          <span class="bar-spinner"></span>
          Saving {{ pendingCount }} score{{ pendingCount !== 1 ? 's' : '' }}...
        </div>
      </template>
      <template v-else>
        <div class="confirm-bar-text">{{ pendingCount }} unsaved score{{ pendingCount !== 1 ? 's' : '' }}</div>
        <div class="confirm-bar-actions">
          <button class="btn sm" @click="discardScores">Discard</button>
          <button class="btn sm primary" @click="saveScores">Save All</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDataStore }    from '../stores/data.js'
import { useUiStore }      from '../stores/ui.js'
import { usePendingStore } from '../stores/pending.js'
import { usePrefsStore }   from '../stores/prefs.js'
import { readActiveWeek, getLeagueAvg, effectiveAvg } from '../utils/data.js'
import { apiPost } from '../api.js'
import PlayerScoreRow from './PlayerScoreRow.vue'
import OddsBlock      from './OddsBlock.vue'

const dataStore    = useDataStore()
const uiStore      = useUiStore()
const pendingStore = usePendingStore()
const prefsStore   = usePrefsStore()

const saving = ref(false)

// ---------------------------------------------------------------------------
// Core data
// ---------------------------------------------------------------------------

const teams = computed(() => readActiveWeek(dataStore.active))

const leagueAvg = computed(() =>
  getLeagueAvg(dataStore.stats, dataStore.settings, prefsStore.avgDisplay)
)

const sourceLabel = computed(() => {
  if (prefsStore.avgDisplay === 'current-season') return 'Season Avg'
  if (prefsStore.avgDisplay === 'all-time') return 'All-time Avg'
  return 'Last Season Avg'
})

// ---------------------------------------------------------------------------
// Rounds / pairings
// ---------------------------------------------------------------------------

function buildPairings(teamsMap, gameNum) {
  const names = Object.keys(teamsMap).sort()
  const seen  = new Set()
  const pairings = []
  names.forEach(t => {
    if (seen.has(t)) return
    const opp = teamsMap[t]?.opponents[gameNum]
    if (opp && teamsMap[opp] && teamsMap[opp].opponents[gameNum] === t) {
      seen.add(t); seen.add(opp)
      pairings.push({ a: teamsMap[t], b: teamsMap[opp] })
    }
    // Teams with no opponent for this round are omitted (they sit out)
  })
  return pairings
}

const rounds = computed(() => {
  const result = []
  for (let g = 1; g <= 3; g++) {
    const pairings = buildPairings(teams.value, g)
    if (pairings.length) result.push({ num: g, pairings })
  }
  return result
})

// ---------------------------------------------------------------------------
// Totals (include pending changes for live feedback)
// ---------------------------------------------------------------------------

function getTotal(teamName, gameNum) {
  const team = teams.value[teamName]
  if (!team) return 0
  return team.players.reduce((s, p) => {
    const key     = `${teamName}|${p.slot}|${gameNum}`
    const pending = pendingStore.pendingScores[key]
    if (pending) return s + (parseInt(pending.score) || 0)
    // Fill slots have no real stored score — use the same rounded league avg
    // that PlayerScoreRow displays, so the team total stays consistent.
    if (p.isFill) return s + (leagueAvg.value > 0 ? Math.round(leagueAvg.value) : 0)
    const raw = gameNum === 1 ? p.g1 : (gameNum === 2 ? p.g2 : p.g3)
    return s + (parseInt(raw) || 0)
  }, 0)
}

function aWins(pairing, gameNum) {
  const a = getTotal(pairing.a.name, gameNum)
  const b = getTotal(pairing.b.name, gameNum)
  return a > 0 && a > b
}
function bWins(pairing, gameNum) {
  const a = getTotal(pairing.a.name, gameNum)
  const b = getTotal(pairing.b.name, gameNum)
  return b > 0 && b > a
}

function expectedTotal(team) {
  return team.players.reduce((s, p) => {
    const avg = effectiveAvg(
      dataStore.stats, dataStore.settings, dataStore.rsvp,
      p.name, p.isFill, leagueAvg.value
    )
    return s + (avg > 0 ? Math.round(avg) : 0)
  }, 0)
}

// ---------------------------------------------------------------------------
// Pending scores / save
// ---------------------------------------------------------------------------

const hasPendingScores = computed(() => Object.keys(pendingStore.pendingScores).length > 0)
const pendingCount     = computed(() => Object.keys(pendingStore.pendingScores).length)

function discardScores() {
  pendingStore.pendingScores = {}
}

async function saveScores() {
  const keys = Object.keys(pendingStore.pendingScores)
  if (!keys.length) return
  saving.value = true
  const batchScores = keys.map(k => {
    const p = pendingStore.pendingScores[k]
    if (p.legacy) return { cell: p.cell, score: p.score, legacy: true }
    return { team: p.team, slot: p.slot, gameNum: p.gameNum, score: p.score }
  })
  try {
    await apiPost('batchUpdateScores', { scores: batchScores })
    await dataStore.loadAll()
    pendingStore.pendingScores = {}
  } finally {
    saving.value = false
  }
}

</script>
