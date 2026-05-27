<template>
  <div v-if="legacyData">
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
    <template v-for="round in legacyData.rounds" :key="round.num">
      <div class="match-header">
        <div class="match-title">Game {{ round.num }}</div>
      </div>

      <div v-for="(pairing, pi) in round.pairings" :key="pi" class="matchup">
        <!-- Team A -->
        <div class="team-block" :class="{ winner: pairing.a.total > pairing.b.total && pairing.a.total > 0 }">
          <div class="team-label" :class="{ winner: pairing.a.total > pairing.b.total && pairing.a.total > 0 }">
            {{ pairing.a.name }}
          </div>
          <!-- Player rows -->
          <div
            v-for="player in pairing.a.players"
            :key="player.name"
            class="player-row"
            :class="{ absent: isOut(player.name) }"
          >
            <div class="player-avatar" :class="{ champ: isChamp(player.name) }">
              {{ initials(player.name) }}
            </div>
            <div class="player-info">
              <div class="player-name">
                {{ player.name
                }}<span v-if="isChamp(player.name)" class="champ-crown">👑</span
                ><span v-if="isOut(player.name)" class="absent-tag">OUT</span>
              </div>
              <div v-if="playerAvg(player.name) > 0" class="player-avg">avg {{ playerAvg(player.name).toFixed(1) }}</div>
            </div>
            <div class="score-inputs">
              <div class="score-group">
                <span class="score-label">G{{ round.num }}</span>
                <div class="score-display" :style="uiStore.matchupsView === 'expected' ? 'color:var(--muted)' : ''">
                  {{ uiStore.matchupsView === 'expected' ? playerExpected(player.name) : (player.score || '—') }}
                </div>
              </div>
            </div>
          </div>
          <!-- Team total row -->
          <div v-if="uiStore.matchupsView === 'expected'" class="team-total-row">
            <span class="total-label">Expected total</span>
            <div class="total-meta"><span class="total-val total-losing">{{ pairing.a.expectedTotal }}</span></div>
          </div>
          <div v-else-if="pairing.a.total > 0" class="team-total-row">
            <span class="total-label">Team total</span>
            <div class="total-meta">
              <span class="total-val" :class="pairing.a.total > pairing.b.total ? 'total-winning' : 'total-losing'">
                {{ pairing.a.total }}
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
        <div class="team-block" :class="{ winner: pairing.b.total > pairing.a.total && pairing.b.total > 0 }">
          <div class="team-label" :class="{ winner: pairing.b.total > pairing.a.total && pairing.b.total > 0 }">
            {{ pairing.b.name }}
          </div>
          <!-- Player rows -->
          <div
            v-for="player in pairing.b.players"
            :key="player.name"
            class="player-row"
            :class="{ absent: isOut(player.name) }"
          >
            <div class="player-avatar" :class="{ champ: isChamp(player.name) }">
              {{ initials(player.name) }}
            </div>
            <div class="player-info">
              <div class="player-name">
                {{ player.name
                }}<span v-if="isChamp(player.name)" class="champ-crown">👑</span
                ><span v-if="isOut(player.name)" class="absent-tag">OUT</span>
              </div>
              <div v-if="playerAvg(player.name) > 0" class="player-avg">avg {{ playerAvg(player.name).toFixed(1) }}</div>
            </div>
            <div class="score-inputs">
              <div class="score-group">
                <span class="score-label">G{{ round.num }}</span>
                <div class="score-display" :style="uiStore.matchupsView === 'expected' ? 'color:var(--muted)' : ''">
                  {{ uiStore.matchupsView === 'expected' ? playerExpected(player.name) : (player.score || '—') }}
                </div>
              </div>
            </div>
          </div>
          <!-- Team total row -->
          <div v-if="uiStore.matchupsView === 'expected'" class="team-total-row">
            <span class="total-label">Expected total</span>
            <div class="total-meta"><span class="total-val total-losing">{{ pairing.b.expectedTotal }}</span></div>
          </div>
          <div v-else-if="pairing.b.total > 0" class="team-total-row">
            <span class="total-label">Team total</span>
            <div class="total-meta">
              <span class="total-val" :class="pairing.b.total > pairing.a.total ? 'total-winning' : 'total-losing'">
                {{ pairing.b.total }}
              </span>
            </div>
          </div>
        </div>
      </div>
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
        <template v-for="round in legacyData.rounds" :key="round.num">
          <OddsBlock
            v-for="(pairing, pi) in round.pairings"
            :key="pi"
            :team-a="oddsTeam(pairing.a)"
            :team-b="oddsTeam(pairing.b)"
            :league-avg="leagueAvg"
            :label="`Game ${round.num} · ${pairing.a.name} vs ${pairing.b.name}`"
          />
        </template>
        <div style="font-size:10px;color:var(--muted2);margin-top:10px;font-style:italic;">
          For entertainment only. Lines are made up.
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore }  from '../stores/data.js'
import { useUiStore }    from '../stores/ui.js'
import { usePrefsStore } from '../stores/prefs.js'
import { getLeagueAvg, isChampion, isPlayerOut, getPlayerCurrentAvg, effectiveAvg } from '../utils/data.js'
import { initials } from '../utils/helpers.js'
import OddsBlock from './OddsBlock.vue'

const dataStore  = useDataStore()
const uiStore    = useUiStore()
const prefsStore = usePrefsStore()

// ---------------------------------------------------------------------------
// League avg
// ---------------------------------------------------------------------------

const leagueAvg = computed(() =>
  getLeagueAvg(dataStore.stats, dataStore.settings, prefsStore.avgDisplay)
)

const sourceLabel = computed(() => {
  if (prefsStore.avgDisplay === 'current-season') return 'Season Avg'
  if (prefsStore.avgDisplay === 'all-time') return 'All-time Avg'
  return 'Last Season Avg'
})

// ---------------------------------------------------------------------------
// Per-player helpers
// ---------------------------------------------------------------------------

function isChamp(name)    { return isChampion(dataStore.champions, name) }
function isOut(name)      { return isPlayerOut(dataStore.rsvp, name) }
function playerAvg(name)  { return getPlayerCurrentAvg(dataStore.stats, dataStore.settings, name, prefsStore.avgDisplay) }
function playerExpected(name) {
  const avg = effectiveAvg(dataStore.stats, dataStore.settings, dataStore.rsvp, name, false, leagueAvg.value)
  return avg > 0 ? Math.round(avg) : '—'
}

// ---------------------------------------------------------------------------
// Parse fixed legacy sheet into structured rounds
// ---------------------------------------------------------------------------

const legacyData = computed(() => {
  const d = dataStore.current
  if (!d) return null

  // Extract players from a set of row indices and specific name/score columns
  function extractPlayers(rowIndices, nameCol, scoreCol) {
    return rowIndices.map(i => {
      const row  = d[i]
      if (!row) return null
      const name = row[nameCol]
      if (!name) return null
      const raw  = row[scoreCol]
      const score = raw != null && raw !== '' ? (parseInt(raw) || 0) : ''
      return { name, score }
    }).filter(Boolean)
  }

  function makeTeam(name, players) {
    const total        = players.reduce((s, p) => s + (parseInt(p.score) || 0), 0)
    const expectedTotal = players.reduce((s, p) => {
      const avg = effectiveAvg(dataStore.stats, dataStore.settings, dataStore.rsvp, p.name, false, leagueAvg.value)
      return s + (avg > 0 ? Math.round(avg) : 0)
    }, 0)
    return { name, players, total, expectedTotal }
  }

  // Fixed layout (v1 sheet):
  // G1: rows 5-7   — col 0 = T1 name, col 2 = T1 score, col 4 = T3 name, col 6 = T3 score
  //     rows 10-12 — col 0 = T2 name, col 2 = T2 score, col 4 = T4 name, col 6 = T4 score
  // G2: rows 18-20 — col 0 = T4 name, col 2 = T4 score, col 4 = T1 name, col 6 = T1 score
  //     rows 23-25 — col 0 = T3 name, col 2 = T3 score, col 4 = T2 name, col 6 = T2 score
  const t1g1 = extractPlayers([5, 6, 7],   0, 2)
  const t3g1 = extractPlayers([5, 6, 7],   4, 6)
  const t2g1 = extractPlayers([10, 11, 12], 0, 2)
  const t4g1 = extractPlayers([10, 11, 12], 4, 6)
  const t4g2 = extractPlayers([18, 19, 20], 0, 2)
  const t1g2 = extractPlayers([18, 19, 20], 4, 6)
  const t3g2 = extractPlayers([23, 24, 25], 0, 2)
  const t2g2 = extractPlayers([23, 24, 25], 4, 6)

  return {
    weekLabel: d[0]?.[0] ?? '',
    rounds: [
      {
        num: 1,
        pairings: [
          { a: makeTeam('Team 1', t1g1), b: makeTeam('Team 3', t3g1) },
          { a: makeTeam('Team 2', t2g1), b: makeTeam('Team 4', t4g1) },
        ],
      },
      {
        num: 2,
        pairings: [
          { a: makeTeam('Team 4', t4g2), b: makeTeam('Team 1', t1g2) },
          { a: makeTeam('Team 3', t3g2), b: makeTeam('Team 2', t2g2) },
        ],
      },
    ],
  }
})

// Adapt a legacy team for OddsBlock (players need isFill field)
function oddsTeam(team) {
  return {
    name: team.name,
    players: team.players.map(p => ({ ...p, isFill: false })),
  }
}

</script>
