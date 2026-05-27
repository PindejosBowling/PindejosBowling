<template>
  <div class="odds-block">
    <!-- Pick-em -->
    <template v-if="odds.fav === 'tie'">
      <div class="odds-block-head">
        <span class="odds-block-label">{{ label }}</span>
        <span class="odds-block-pickem">PICK 'EM ({{ expectedA }})</span>
      </div>
      <div class="odds-block-teams">
        <div class="odds-team-side">
          <div class="odds-team-name">{{ teamA.name }}<span class="odds-team-proj">{{ expectedA }}</span></div>
          <div class="odds-roster">{{ teamARoster }}</div>
        </div>
        <div class="odds-team-side">
          <div class="odds-team-name">{{ teamB.name }}<span class="odds-team-proj">{{ expectedB }}</span></div>
          <div class="odds-roster">{{ teamBRoster }}</div>
        </div>
      </div>
    </template>

    <!-- Normal line -->
    <template v-else>
      <div class="odds-block-head">
        <span class="odds-block-label">{{ label }}</span>
        <div class="odds-line-stack">
          <div class="odds-line-row">
            <span class="odds-prefix">SPREAD</span>
            <span class="odds-chip fav">{{ favName }} -{{ odds.spread }}</span>
          </div>
          <div class="odds-line-row">
            <span class="odds-prefix">ML</span>
            <span class="odds-chip fav">{{ favName }} {{ odds.ml.fav }}</span>
            <span class="odds-chip dog">{{ dogName }} {{ odds.ml.dog }}</span>
          </div>
        </div>
      </div>
      <div class="odds-block-teams">
        <div class="odds-team-side" :class="teamAIsFav ? 'fav' : 'dog'">
          <div class="odds-team-name">
            {{ teamA.name }}
            <span v-if="teamAIsFav" class="odds-tag-fav">FAV</span>
            <span class="odds-team-proj">{{ expectedA }}</span>
          </div>
          <div class="odds-roster">{{ teamARoster }}</div>
        </div>
        <div class="odds-team-side" :class="teamAIsFav ? 'dog' : 'fav'">
          <div class="odds-team-name">
            {{ teamB.name }}
            <span v-if="!teamAIsFav" class="odds-tag-fav">FAV</span>
            <span class="odds-team-proj">{{ expectedB }}</span>
          </div>
          <div class="odds-roster">{{ teamBRoster }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { effectiveAvg } from '../utils/data.js'
import { spreadAndML }  from '../utils/helpers.js'

const props = defineProps({
  /** Team objects: { name: string, players: { name, isFill, ... }[] } */
  teamA:    { type: Object, required: true },
  teamB:    { type: Object, required: true },
  leagueAvg: { type: Number, default: 0 },
  label:    { type: String, default: '' },
})

const dataStore = useDataStore()

const expectedA = computed(() =>
  props.teamA.players.reduce((s, p) => {
    const avg = effectiveAvg(
      dataStore.stats, dataStore.settings, dataStore.rsvp,
      p.name, p.isFill, props.leagueAvg
    )
    return s + (avg > 0 ? Math.round(avg) : 0)
  }, 0)
)

const expectedB = computed(() =>
  props.teamB.players.reduce((s, p) => {
    const avg = effectiveAvg(
      dataStore.stats, dataStore.settings, dataStore.rsvp,
      p.name, p.isFill, props.leagueAvg
    )
    return s + (avg > 0 ? Math.round(avg) : 0)
  }, 0)
)

const odds      = computed(() => spreadAndML(expectedA.value, expectedB.value))
const teamAIsFav = computed(() => odds.value.fav === 't1')

const favName = computed(() =>
  odds.value.fav === 't1' ? props.teamA.name :
  odds.value.fav === 't2' ? props.teamB.name : ''
)
const dogName = computed(() =>
  odds.value.fav === 't1' ? props.teamB.name :
  odds.value.fav === 't2' ? props.teamA.name : ''
)

const teamARoster = computed(() =>
  props.teamA.players.map(p => p.isFill ? 'Fill' : p.name).join(' · ') || '—'
)
const teamBRoster = computed(() =>
  props.teamB.players.map(p => p.isFill ? 'Fill' : p.name).join(' · ') || '—'
)
</script>
