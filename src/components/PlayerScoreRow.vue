<template>
  <div class="player-row" :class="{ absent: isOut }">
    <div class="icon-box sm player-avatar" :class="{ champ: isChamp }">
      {{ player.isFill ? '∅' : initials(player.name) }}
    </div>
    <div class="player-info">
      <div class="player-name">
        <template v-if="player.isFill">
          <span style="color:var(--muted);font-style:italic;">League Avg Fill</span>
        </template>
        <template v-else>
          {{ player.name
          }}<span v-if="isChamp" class="champ-crown">👑</span
          ><span v-if="isOut" class="absent-tag">OUT</span
          ><span v-if="player.isFill" class="fill-tag">FILL</span>
        </template>
      </div>
      <div v-if="playerAvg > 0 && !player.isFill" class="player-avg">avg {{ playerAvg.toFixed(1) }}</div>
      <div v-else-if="player.isFill" class="player-avg">fill</div>
    </div>
    <div class="score-inputs">
      <div class="score-group">
        <span class="label-sm">G{{ gameNum }}</span>
        <!-- Fill slot: read-only league avg display -->
        <div v-if="player.isFill" class="score-display" style="color:var(--muted);">
          {{ Math.round(leagueAvg) }}
        </div>
        <!-- Expected mode: computed avg read-only -->
        <div v-else-if="mode === 'expected'" class="score-display" style="color:var(--muted);">
          {{ expectedScore }}
        </div>
        <!-- Scores mode: editable input -->
        <input
          v-else
          type="number"
          inputmode="numeric"
          pattern="[0-9]*"
          :class="{
            'has-score': hasValue,
            'score-pending': isPending,
            'absent-prefill': isAbsentPrefill,
          }"
          placeholder="—"
          :value="displayValue"
          @input="onInput"
          :title="isAbsentPrefill ? 'Pre-filled league avg (player is Out). Type real score to override.' : ''"
        >
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore }    from '../stores/data.js'
import { usePendingStore } from '../stores/pending.js'
import { usePrefsStore }   from '../stores/prefs.js'
import { initials }        from '../utils/helpers.js'
import { isChampion, isPlayerOut, getPlayerCurrentAvg, effectiveAvg } from '../utils/data.js'

const props = defineProps({
  /** Active-week player: { name, slot, g1, g2, g3, isFill } */
  player:   { type: Object, required: true },
  teamName: { type: String, required: true },
  gameNum:  { type: Number, required: true },
  mode:     { type: String, default: 'scores' }, // 'scores' | 'expected'
  leagueAvg: { type: Number, default: 0 },
})

const dataStore    = useDataStore()
const pendingStore = usePendingStore()
const prefsStore   = usePrefsStore()

const isChamp = computed(() => isChampion(dataStore.champions, props.player.name))
const isOut   = computed(() => !props.player.isFill && isPlayerOut(dataStore.rsvp, props.player.name))

const playerAvg = computed(() =>
  props.player.isFill
    ? props.leagueAvg
    : getPlayerCurrentAvg(dataStore.stats, dataStore.settings, props.player.name, prefsStore.avgDisplay)
)

const expectedScore = computed(() => {
  const avg = effectiveAvg(
    dataStore.stats, dataStore.settings, dataStore.rsvp,
    props.player.name, props.player.isFill, props.leagueAvg
  )
  return avg > 0 ? Math.round(avg) : '—'
})

// Raw score from the active-week sheet for this game
const rawScore = computed(() => {
  if (props.gameNum === 1) return props.player.g1
  if (props.gameNum === 2) return props.player.g2
  return props.player.g3
})

const pendingKey   = computed(() => `${props.teamName}|${props.player.slot}|${props.gameNum}`)
const pendingEntry = computed(() => pendingStore.pendingScores[pendingKey.value])

// Value shown in the input (pending takes priority over stored)
const displayValue = computed(() => {
  if (pendingEntry.value) return pendingEntry.value.score
  return rawScore.value === '' || rawScore.value == null ? '' : rawScore.value
})

const hasValue      = computed(() => displayValue.value !== '' && displayValue.value != null)
const isPending     = computed(() => !!pendingEntry.value)
// Absent player whose field already has a league-avg prefill from the backend
const isAbsentPrefill = computed(() =>
  isOut.value && rawScore.value !== '' && rawScore.value != null
)

function onInput(e) {
  const val     = e.target.value
  const initial = rawScore.value === '' || rawScore.value == null ? '' : String(rawScore.value)
  if (val !== initial && val !== '') {
    pendingStore.pendingScores = {
      ...pendingStore.pendingScores,
      [pendingKey.value]: {
        team:    props.teamName,
        slot:    props.player.slot,
        gameNum: props.gameNum,
        score:   val,
      },
    }
  } else {
    const next = { ...pendingStore.pendingScores }
    delete next[pendingKey.value]
    pendingStore.pendingScores = next
  }
}
</script>
