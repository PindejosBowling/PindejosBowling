<template>
  <!-- Admin dialogs — rendered on top of everything via Teleport to body -->
  <AdminAddPlayerDialog v-if="activeDialog === 'add-player'"  @close="activeDialog = null" />
  <AdminArchiveDialog   v-if="activeDialog === 'archive'"     @close="activeDialog = null" />
  <AdminEndSeasonDialog v-if="activeDialog === 'end-season'"  @close="activeDialog = null" />

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
      <div class="more-tile" @click="activeDialog = 'add-player'">
        <div class="more-tile-icon">➕</div>
        <div class="more-tile-label">Add Player</div>
      </div>
      <div class="more-tile" @click="activeDialog = 'archive'">
        <div class="more-tile-icon">📦</div>
        <div class="more-tile-label">Archive & Advance</div>
      </div>
      <div class="more-tile" @click="activeDialog = 'end-season'">
        <div class="more-tile-icon">🥇</div>
        <div class="more-tile-label">End Season</div>
      </div>
      <div class="more-tile" @click="uiStore.moreView = 'playoffs'">
        <div class="more-tile-icon">🏁</div>
        <div class="more-tile-label">Playoffs</div>
      </div>
    </div>
  </div>

  <!-- Sub-views wired in by Tasks 4b–4i: -->
  <PlayerList      v-else-if="uiStore.moreView === 'player-list'" />
  <PlayerDetail    v-else-if="uiStore.moreView === 'player-detail'" />
  <SeasonHistory   v-else-if="uiStore.moreView === 'season-history'" />
  <LeagueRecords   v-else-if="uiStore.moreView === 'records'" />
  <HeadToHead      v-else-if="uiStore.moreView === 'h2h'" />
  <Chemistry       v-else-if="uiStore.moreView === 'chemistry'" />
  <TrashBoard      v-else-if="uiStore.moreView === 'board'" />
  <GenerateTeams   v-else-if="uiStore.moreView === 'generate'" />
  <Playoffs        v-else-if="uiStore.moreView === 'playoffs'" />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '../stores/ui.js'

// Sub-views
import PlayerList    from '../components/PlayerList.vue'
import PlayerDetail  from '../components/PlayerDetail.vue'
import SeasonHistory from '../components/SeasonHistory.vue'
import LeagueRecords from '../components/LeagueRecords.vue'
import HeadToHead    from '../components/HeadToHead.vue'
import Chemistry     from '../components/Chemistry.vue'
import TrashBoard    from '../components/TrashBoard.vue'
import GenerateTeams from '../components/GenerateTeams.vue'

// Admin dialogs
import AdminAddPlayerDialog  from '../components/AdminAddPlayerDialog.vue'
import AdminArchiveDialog    from '../components/AdminArchiveDialog.vue'
import AdminEndSeasonDialog  from '../components/AdminEndSeasonDialog.vue'

// Other sub-views
import Playoffs from '../components/Playoffs.vue'

const uiStore = useUiStore()

/** Which admin dialog is open: 'add-player' | 'archive' | 'end-season' | null */
const activeDialog = ref(null)

// Bridge: allow legacy switchTab() to reset moreView to 'home' on direct nav clicks
onMounted(() => {
  window.__resetMoreView = () => { uiStore.moreView = 'home' }
})
onUnmounted(() => {
  delete window.__resetMoreView
})
</script>
