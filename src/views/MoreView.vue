<template>
  <!-- Back button — visible whenever a sub-view is active -->
  <button v-if="uiStore.moreView !== 'home'" class="back-btn" @click="uiStore.moreView = 'home'">← Back</button>

  <!-- Home menu -->
  <div v-if="uiStore.moreView === 'home'">
    <div class="tab-title"><h2>More</h2></div>

    <div class="section-header">League Tools</div>
    <div class="more-grid">
      <div class="more-tile" @click="uiStore.moreView = 'player-list'">
        <div class="more-tile-icon">🎳</div>
        <div class="more-tile-label">Players</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'records'">
        <div class="more-tile-icon">🏆</div>
        <div class="more-tile-label">Records</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'h2h'">
        <div class="more-tile-icon">⚔️</div>
        <div class="more-tile-label">Head to Head</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'chemistry'">
        <div class="more-tile-icon">🧪</div>
        <div class="more-tile-label">Chemistry</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'season-history'">
        <div class="more-tile-icon">📅</div>
        <div class="more-tile-label">Past Seasons</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'board'">
        <div class="more-tile-icon">🗑️</div>
        <div class="more-tile-label">Trash Board</div>
      </div>
    </div>

    <div class="section-header">League Admin</div>
    <div class="more-grid">
      <div class="more-tile" @click="uiStore.moreView = 'generate'">
        <div class="more-tile-icon">🎲</div>
        <div class="more-tile-label">Generate Teams</div>
      </div>
      <div class="more-tile" @click="window.openAddPlayer && window.openAddPlayer()">
        <div class="more-tile-icon">➕</div>
        <div class="more-tile-label">Add Player</div>
      </div>
      <div class="more-tile" @click="window.confirmArchive && window.confirmArchive()">
        <div class="more-tile-icon">📦</div>
        <div class="more-tile-label">Archive & Advance</div>
      </div>
      <div class="more-tile" @click="window.openEndSeason && window.openEndSeason()">
        <div class="more-tile-icon">🥇</div>
        <div class="more-tile-label">End Season</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'playoffs'">
        <div class="more-tile-icon">🏁</div>
        <div class="more-tile-label">Playoffs</div>
        <div class="more-tile-coming">Coming</div>
      </div>
    </div>
  </div>

  <!-- Sub-views wired in by Tasks 4b–4i: -->
  <!-- <PlayerList      v-else-if="uiStore.moreView === 'player-list'" /> -->
  <!-- <PlayerDetail    v-else-if="uiStore.moreView === 'player-detail'" /> -->
  <!-- <SeasonHistory   v-else-if="uiStore.moreView === 'season-history'" /> -->
  <!-- <LeagueRecords   v-else-if="uiStore.moreView === 'records'" /> -->
  <!-- <HeadToHead      v-else-if="uiStore.moreView === 'h2h'" /> -->
  <!-- <Chemistry       v-else-if="uiStore.moreView === 'chemistry'" /> -->
  <!-- <TrashBoard      v-else-if="uiStore.moreView === 'board'" /> -->
  <!-- <GenerateTeams   v-else-if="uiStore.moreView === 'generate'" /> -->
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '../stores/ui.js'

const uiStore = useUiStore()

// Bridge: allow legacy switchTab() to reset moreView to 'home' on direct nav clicks
onMounted(() => {
  window.__resetMoreView = () => { uiStore.moreView = 'home' }
})
onUnmounted(() => {
  delete window.__resetMoreView
})
</script>
