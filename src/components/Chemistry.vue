<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="uiStore.moreView = 'home'">←</button>
    <div class="player-detail-name">Team Chemistry</div>
  </div>

  <div class="chemistry-tabs">
    <button
      class="chem-tab"
      :class="{ active: uiStore.chemMode === 'pairs' }"
      @click="uiStore.chemMode = 'pairs'; uiStore.chemExpanded = false"
    >Pairs</button>
    <button
      class="chem-tab"
      :class="{ active: uiStore.chemMode === 'trios' }"
      @click="uiStore.chemMode = 'trios'; uiStore.chemExpanded = false"
    >Trios</button>
  </div>

  <div v-if="!allGroups.length" class="empty-state">Not enough data yet.</div>

  <template v-else>
    <div
      v-for="group in visibleGroups"
      :key="group.names.join('|')"
      class="chemistry-card"
    >
      <div class="chem-pair">
        <template v-for="(name, i) in group.names" :key="name">
          <span v-if="i > 0"> + </span>
          <span>{{ name }}</span><span v-if="isChampion(dataStore.champions, name)" class="champ-crown">👑</span>
        </template>
      </div>
      <div class="chem-rate">{{ (group.winRate * 100).toFixed(0) }}%</div>
      <div class="chem-games">{{ group.wins }}—{{ group.losses }} · {{ group.weeks }}wk</div>
    </div>

    <button
      v-if="allGroups.length > 10"
      class="btn sm"
      style="margin-top: 8px;"
      @click="uiStore.chemExpanded = !uiStore.chemExpanded"
    >
      {{ uiStore.chemExpanded ? 'Show top 10' : `Show all ${allGroups.length}` }}
    </button>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { getChemistry, isChampion } from '../utils/data.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()

const groupSize = computed(() => uiStore.chemMode === 'pairs' ? 2 : 3)

const allGroups = computed(() => getChemistry(dataStore.stats, groupSize.value))

const visibleGroups = computed(() =>
  uiStore.chemExpanded ? allGroups.value : allGroups.value.slice(0, 10)
)
</script>
