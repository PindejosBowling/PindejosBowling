<template>
  <div class="team-block" :class="{ winner }">
    <div class="label team-label" :class="{ winner }">{{ team }}</div>
    <div
      v-for="player in players"
      :key="player.name"
      class="player-row"
      :class="{ absent: !player.present }"
    >
      <div class="player-avatar">{{ initials(player.name) }}</div>
      <div class="player-info">
        <div class="player-name">
          {{ player.name }}
          <span v-if="!player.present" class="absent-tag">OUT</span>
        </div>
      </div>
      <div class="score-inputs">
        <div class="score-group">
          <span class="label-sm">Score</span>
          <div class="score-display" :style="{ color: player.score ? 'var(--text)' : 'var(--muted)' }">
            {{ player.score || '—' }}
          </div>
        </div>
      </div>
    </div>
    <div class="team-total-row">
      <span class="total-label">Team total</span>
      <div class="total-meta">
        <span class="total-val" :class="winner ? 'total-winning' : 'total-losing'">{{ total }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { initials } from '../utils/helpers.js'

defineProps({
  team:    { type: String,  required: true },
  players: { type: Array,   required: true },
  total:   { type: Number,  required: true },
  winner:  { type: Boolean, default: false },
})
</script>
