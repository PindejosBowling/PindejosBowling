<template>
  <Teleport to="body">
    <div class="modal-backdrop active" @click.self="!saving && $emit('close')">
      <div class="modal">
        <div class="modal-title">End Season {{ seasonNum }}</div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:16px;">
          Choose champion(s). For team championships, select all members.
          Season will roll over to {{ seasonNum + 1 }} and current week resets to 1.
        </p>

        <!-- Player checklist -->
        <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:8px;margin-bottom:12px;">
          <label
            v-for="player in allPlayers"
            :key="player"
            style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;"
          >
            <input
              type="checkbox"
              :value="player"
              v-model="champions"
              style="accent-color:var(--gold);width:18px;height:18px;"
            >
            <span style="font-family:'Barlow Condensed',sans-serif;font-weight:600;">{{ player }}</span>
          </label>
        </div>

        <textarea
          v-model="notes"
          class="modal-input"
          placeholder="Notes (optional)"
          style="text-align:left;min-height:60px;"
        ></textarea>

        <div class="btn-row">
          <button class="btn" :disabled="saving" @click="$emit('close')">Cancel</button>
          <button class="btn primary" :disabled="saving" @click="submit">
            {{ saving ? 'Ending Season…' : 'End Season' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { apiPost }      from '../api.js'
import { getCurrentSeason, aggregateStandings } from '../utils/data.js'

const emit = defineEmits(['close'])

const dataStore = useDataStore()
const uiStore   = useUiStore()

const champions = ref([])
const notes     = ref('')
const saving    = ref(false)

const seasonNum = computed(() =>
  parseInt(getCurrentSeason(dataStore.stats, dataStore.settings)) || 1
)

const allPlayers = computed(() => {
  const standings     = aggregateStandings(dataStore.stats, String(seasonNum.value))
  const fromStandings = standings.map(p => p.name)
  const fromRoster    = dataStore.roster
    ? dataStore.roster.slice(1).filter(r => r[0]).map(r => r[0])
    : []
  return Array.from(new Set([...fromStandings, ...fromRoster])).sort()
})

async function submit() {
  saving.value = true
  try {
    const r = await apiPost('endSeason', {
      champions: champions.value,
      notes: notes.value.trim(),
    })
    if (r.error) { window.toast?.(r.error, 'error'); saving.value = false; return }
    window.toast?.(`Season ${r.season} closed`, 'success')
    await dataStore.loadAll()
    uiStore.moreView = 'home'
    emit('close')
  } catch {
    window.toast?.('Failed to end season', 'error')
    saving.value = false
  }
}
</script>
