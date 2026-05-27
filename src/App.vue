<template>
  <!-- Teleport entries added here as each view is migrated (Tasks 1–6) -->
  <Teleport to="#standings-content">
    <StandingsView />
  </Teleport>
  <Teleport to="#rsvp-content">
    <RsvpView />
  </Teleport>
</template>

<script setup>
import { onMounted } from 'vue'
import { useDataStore } from './stores/data.js'
import StandingsView from './views/StandingsView.vue'
import RsvpView      from './views/RsvpView.vue'

const dataStore = useDataStore()
onMounted(() => dataStore.loadAll())
</script>
