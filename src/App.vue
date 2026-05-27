<template>
  <!-- ── Shell components (header / nav / modal) ── -->
  <Teleport to="header">
    <AppHeader />
  </Teleport>

  <Teleport to="nav">
    <AppNav />
  </Teleport>

  <!-- Modal is appended to <body> so it sits above all other stacking contexts -->
  <Teleport to="body">
    <AppModal />
  </Teleport>

  <!-- ── Content views ── -->
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
import { onMounted }     from 'vue'
import { useDataStore }  from './stores/data.js'
import { useUiStore }    from './stores/ui.js'
import { useModalStore } from './stores/modal.js'

// Shell components
import AppHeader from './components/AppHeader.vue'
import AppNav    from './components/AppNav.vue'
import AppModal  from './components/AppModal.vue'

// Content views
import MatchupsView  from './views/MatchupsView.vue'
import StandingsView from './views/StandingsView.vue'
import RsvpView      from './views/RsvpView.vue'
import HistoryView   from './views/HistoryView.vue'
import MoreView      from './views/MoreView.vue'

const dataStore  = useDataStore()
const uiStore    = useUiStore()
const modalStore = useModalStore()

onMounted(() => dataStore.loadAll())

// ─────────────────────────────────────────────────────────────
// Global window APIs
// Components and inline onclick="" handlers in modal HTML reach
// these functions through the window object.
// ─────────────────────────────────────────────────────────────

/** Show the modal with an HTML string. */
window.openModal = (html) => modalStore.open(html)

/** Close the modal. */
window.closeModal = () => modalStore.close()

/**
 * Switch the visible tab.
 * Used by StandingsView (goToPlayer) and GenerateTeams for cross-view navigation.
 *
 * @param {string} tab - one of 'matchups' | 'rsvp' | 'standings' | 'history' | 'more'
 * @param {{ preserveView?: boolean }} [opts]
 */
window.switchTab = (tab, opts = {}) => {
  if (tab === 'more' && !opts.preserveView) {
    uiStore.moreView = 'home'
  }
  uiStore.setTab(tab)
}

/** Simple DOM toast notification (used by admin modal actions below). */
function toast(msg, type = '') {
  const t = document.createElement('div')
  t.className = 'toast' + (type ? ' ' + type : '')
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2400)
}
window.toast = toast

</script>
