<template>
  <AdminAddPlayerDialog v-if="activeDialog === 'add-player'" @close="activeDialog = null" />
  <AdminArchiveDialog   v-if="activeDialog === 'archive'"    @close="activeDialog = null" />
  <AdminEndSeasonDialog v-if="activeDialog === 'end-season'" @close="activeDialog = null" />

  <div class="tab-title"><h2>More</h2></div>

  <div class="section-header">League Tools</div>
  <div class="more-grid">
    <div class="more-tile" @click="router.push('/more/players')">
      <div class="more-tile-icon">🎳</div>
      <div class="more-tile-label">Players</div>
    </div>
    <div class="more-tile" @click="router.push('/more/records')">
      <div class="more-tile-icon">🏆</div>
      <div class="more-tile-label">Records</div>
    </div>
    <div class="more-tile" @click="router.push('/more/h2h')">
      <div class="more-tile-icon">⚔️</div>
      <div class="more-tile-label">Head to Head</div>
    </div>
    <div class="more-tile" @click="router.push('/more/chemistry')">
      <div class="more-tile-icon">🧪</div>
      <div class="more-tile-label">Chemistry</div>
    </div>
    <div class="more-tile" @click="router.push('/more/season-history')">
      <div class="more-tile-icon">📅</div>
      <div class="more-tile-label">Past Seasons</div>
    </div>
    <div class="more-tile" @click="router.push('/more/board')">
      <div class="more-tile-icon">🗑️</div>
      <div class="more-tile-label">Trash Board</div>
    </div>
  </div>

  <div class="section-header">League Admin</div>
  <div class="more-grid">
    <div class="more-tile" @click="router.push('/more/generate')">
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
    <div class="more-tile" @click="router.push('/more/playoffs')">
      <div class="more-tile-icon">🏁</div>
      <div class="more-tile-label">Playoffs</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminAddPlayerDialog from '../components/AdminAddPlayerDialog.vue'
import AdminArchiveDialog   from '../components/AdminArchiveDialog.vue'
import AdminEndSeasonDialog from '../components/AdminEndSeasonDialog.vue'

const router      = useRouter()
const activeDialog = ref(null)
</script>
