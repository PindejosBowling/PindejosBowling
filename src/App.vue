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
</template>

<script setup>
import { onMounted }     from 'vue'
import { useDataStore }  from './stores/data.js'
import { useModalStore } from './stores/modal.js'
import AppHeader from './components/AppHeader.vue'
import AppNav    from './components/AppNav.vue'
import AppModal  from './components/AppModal.vue'

const dataStore  = useDataStore()
const modalStore = useModalStore()

onMounted(() => dataStore.loadAll())

window.openModal  = (html) => modalStore.open(html)
window.closeModal = () => modalStore.close()

function toast(msg, type = '') {
  const t = document.createElement('div')
  t.className = 'toast' + (type ? ' ' + type : '')
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2400)
}
window.toast = toast
</script>
