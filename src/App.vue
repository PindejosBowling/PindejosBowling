<template>
  <!-- Teleport entries added here as each view is migrated (Tasks 1–6) -->
  <Teleport to="#matchups-content">
    <MatchupsView />
  </Teleport>
  <Teleport to="#standings-content">
    <StandingsView />
  </Teleport>
  <Teleport to="#rsvp-content">
    <RsvpView />
  </Teleport>
  <Teleport to="#history-content">
    <HistoryView />
  </Teleport>
  <Teleport to="#more-content">
    <MoreView />
  </Teleport>
</template>

<script setup>
import { onMounted } from 'vue'
import { useDataStore } from './stores/data.js'
import MatchupsView  from './views/MatchupsView.vue'
import StandingsView from './views/StandingsView.vue'
import RsvpView      from './views/RsvpView.vue'
import HistoryView   from './views/HistoryView.vue'
import MoreView      from './views/MoreView.vue'

const dataStore = useDataStore()
onMounted(() => dataStore.loadAll())
</script>
