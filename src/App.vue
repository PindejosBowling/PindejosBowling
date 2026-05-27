<template>
  <header>
    <AppHeader />
  </header>
  <main class="container">
    <RouterView />
  </main>
  <nav>
    <AppNav />
  </nav>
  <AppModal />
  <AppToast />
</template>

<script setup>
import { onMounted }     from 'vue'
import { useDataStore }  from './stores/data.js'
import { useModalStore } from './stores/modal.js'
import AppHeader from './components/AppHeader.vue'
import AppNav    from './components/AppNav.vue'
import AppModal  from './components/AppModal.vue'
import AppToast  from './components/AppToast.vue'

const dataStore  = useDataStore()
const modalStore = useModalStore()

onMounted(() => dataStore.loadAll())

window.openModal  = (html) => modalStore.open(html)
window.closeModal = () => modalStore.close()
</script>
