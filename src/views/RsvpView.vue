<template>
  <div v-if="dataStore.loading || !dataStore.roster" class="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading RSVP</div>
  </div>
  <div v-else>
    <div class="tab-title"><h2>RSVP</h2></div>
    <div class="rsvp-summary">
      <div class="card-sm rsvp-stat in">
        <div class="label-sm">In</div>
        <div class="rsvp-stat-val">{{ inCount }}</div>
      </div>
      <div class="card-sm rsvp-stat out">
        <div class="label-sm">Out</div>
        <div class="rsvp-stat-val">{{ outCount }}</div>
      </div>
      <div class="card-sm rsvp-stat unknown">
        <div class="label-sm">No reply</div>
        <div class="rsvp-stat-val">{{ noReply }}</div>
      </div>
    </div>
    <div class="label section-header">
      This Week
      <div class="actions">
        <button class="btn sm danger" @click="resetRSVP">Reset</button>
      </div>
    </div>
    <div class="card">
      <div
        v-for="player in roster"
        :key="player[0]"
        class="list-row rsvp-row"
        :class="{ pending: isPending(player[0]) }"
      >
        <div class="rsvp-name">
          {{ player[0] }}
          <span v-if="isPending(player[0])" class="pending-dot" title="Unsaved"></span>
        </div>
        <div class="rsvp-buttons">
          <button
            class="rsvp-btn in"
            :class="{ active: effectiveStatus(player[0]) === 'In' }"
            @click="stageRSVP(player[0], 'In')"
          >In</button>
          <button
            class="rsvp-btn out"
            :class="{ active: effectiveStatus(player[0]) === 'Out' }"
            @click="stageRSVP(player[0], 'Out')"
          >Out</button>
        </div>
      </div>
    </div>

    <div v-if="hasPendingChanges" class="confirm-bar floating" :class="{ saving }">
      <div class="confirm-bar-text">
        {{ pendingCount }} unsaved change{{ pendingCount !== 1 ? 's' : '' }}
      </div>
      <div class="confirm-bar-actions">
        <button class="btn sm" :disabled="saving" @click="discard">Discard</button>
        <button class="btn sm primary" :disabled="saving" @click="saveChanges">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDataStore }    from '../stores/data.js'
import { usePendingStore } from '../stores/pending.js'
import { apiPost }         from '../api.js'

const dataStore    = useDataStore()
const pendingStore = usePendingStore()

const saving = ref(false)

// ── Data ────────────────────────────────────────────────────────────────────

const roster = computed(() => (dataStore.roster ?? []).slice(1).filter(r => r[0]))

function currentStatus(name) {
  const row = (dataStore.rsvp ?? []).slice(1).find(r => r[0] === name)
  return row ? row[1] : ''
}

function effectiveStatus(name) {
  return pendingStore.pendingRSVP[name] ?? currentStatus(name)
}

function isPending(name) {
  return pendingStore.pendingRSVP[name] !== undefined
}

// ── Counts ───────────────────────────────────────────────────────────────────

const inCount  = computed(() => roster.value.filter(r => effectiveStatus(r[0]) === 'In').length)
const outCount = computed(() => roster.value.filter(r => effectiveStatus(r[0]) === 'Out').length)
const noReply  = computed(() => roster.value.filter(r => !effectiveStatus(r[0])).length)

const pendingCount     = computed(() => Object.keys(pendingStore.pendingRSVP).length)
const hasPendingChanges = computed(() => pendingCount.value > 0)

// ── Actions ──────────────────────────────────────────────────────────────────

function stageRSVP(name, status) {
  const alreadyStaged  = pendingStore.pendingRSVP[name] === status
  const alreadyCurrent = pendingStore.pendingRSVP[name] === undefined && currentStatus(name) === status
  if (alreadyStaged || alreadyCurrent) {
    const next = { ...pendingStore.pendingRSVP }
    delete next[name]
    pendingStore.pendingRSVP = next
  } else {
    pendingStore.pendingRSVP = { ...pendingStore.pendingRSVP, [name]: status }
  }
}

function discard() {
  pendingStore.pendingRSVP = {}
}

async function resetRSVP() {
  if (!window.confirm('Reset all RSVPs for the upcoming week?')) return
  await apiPost('resetRSVP')
  await dataStore.loadAll()
  pendingStore.pendingRSVP = {}
}

async function saveChanges() {
  saving.value = true
  const changes = Object.entries(pendingStore.pendingRSVP).map(([name, status]) => ({ name, status }))
  await apiPost('batchUpdateRSVP', { changes })
  await dataStore.loadAll()
  pendingStore.pendingRSVP = {}
  saving.value = false
}
</script>
