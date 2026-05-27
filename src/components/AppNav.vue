<template>
  <button class="nav-btn" :class="{ active: isActive('/') }"          @click="router.push('/')">
    <span class="nav-icon">🎳</span>This Week
  </button>
  <button class="nav-btn" :class="{ active: isActive('/rsvp') }"      @click="router.push('/rsvp')">
    <span class="nav-icon">📋</span>RSVP
  </button>
  <button class="nav-btn" :class="{ active: isActive('/standings') }" @click="router.push('/standings')">
    <span class="nav-icon">📊</span>Standings
  </button>
  <button class="nav-btn" :class="{ active: isActive('/history') }"   @click="router.push('/history')">
    <span class="nav-icon">🗓️</span>Matches
  </button>
  <button class="nav-btn" :class="{ active: isActive('/more') }"      @click="router.push('/more')">
    <span class="nav-icon">⋯</span>More
  </button>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route  = useRoute()

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}
</script>
