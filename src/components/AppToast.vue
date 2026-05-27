<template>
  <div
    v-for="t in uiStore.toasts"
    :key="t.id"
    class="toast"
    :class="t.type"
  >{{ t.msg }}</div>
</template>

<script setup>
import { useUiStore } from '../stores/ui.js'
const uiStore = useUiStore()
</script>
