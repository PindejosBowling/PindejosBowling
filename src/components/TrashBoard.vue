<template>
  <div class="player-detail-header">
    <button class="back-btn" @click="router.push('/more')">←</button>
    <div class="player-detail-name">Trash Board</div>
  </div>

  <div class="board-composer">
    <div class="board-author-row">
      <input
        class="board-author-input"
        v-model="prefsStore.myName"
        placeholder="Your name"
        type="text"
      />
    </div>
    <textarea v-model="msg" placeholder="Talk shit, hype the boys, whatever..."></textarea>
    <button
      class="btn primary"
      style="margin-top: 8px;"
      :disabled="posting"
      @click="post()"
    >{{ posting ? 'Posting…' : 'Post' }}</button>
  </div>

  <template v-if="posts.length">
    <div v-for="(p, i) in posts" :key="i" class="board-post">
      <div class="board-post-head">
        <div class="board-author">
          {{ p[1] || 'Anon' }}<span v-if="isChampion(dataStore.champions, p[1])" class="champ-crown">👑</span>
        </div>
        <div class="board-time">{{ timeAgo(p[0]) }}</div>
      </div>
      <div class="board-msg">{{ p[2] }}</div>
    </div>
  </template>
  <div v-else class="empty-state">Be the first to talk some shit.</div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter }     from 'vue-router'
import { useDataStore }  from '../stores/data.js'
import { usePrefsStore } from '../stores/prefs.js'
import { isChampion }    from '../utils/data.js'
import { timeAgo }       from '../utils/helpers.js'
import { apiPost }       from '../api.js'

const dataStore  = useDataStore()
const router     = useRouter()
const prefsStore = usePrefsStore()

const msg     = ref('')
const posting = ref(false)

const posts = computed(() =>
  (dataStore.board ?? []).slice(1).filter(p => p[2]).slice().reverse()
)

async function post() {
  if (!prefsStore.myName.trim() || !msg.value.trim()) return
  posting.value = true
  await apiPost('postToBoard', { author: prefsStore.myName, message: msg.value })
  await dataStore.loadAll()
  msg.value = ''
  posting.value = false
}
</script>
