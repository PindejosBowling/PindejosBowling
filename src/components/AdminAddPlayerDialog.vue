<template>
  <Teleport to="body">
    <div class="modal-backdrop active" @click.self="$emit('close')">
      <div class="modal">
        <div class="modal-title">Add Player</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px;">
          New bowler will be added to your roster, marked unavailable until they RSVP.
        </p>
        <input
          ref="inputRef"
          v-model="name"
          class="modal-input"
          placeholder="Full name"
          @keydown.enter="submit"
        >
        <div class="btn-row">
          <button class="btn" :disabled="saving" @click="$emit('close')">Cancel</button>
          <button class="btn primary" :disabled="saving || !name.trim()" @click="submit">
            {{ saving ? 'Adding…' : 'Add' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore }   from '../stores/ui.js'
import { apiPost } from '../api.js'

const emit = defineEmits(['close'])

const dataStore = useDataStore()
const uiStore   = useUiStore()
const name     = ref('')
const saving   = ref(false)
const inputRef = ref(null)

onMounted(() => nextTick(() => inputRef.value?.focus()))

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  saving.value = true
  try {
    const r = await apiPost('addPlayer', { name: trimmed })
    if (r.error) { uiStore.showToast(r.error, 'error'); saving.value = false; return }
    uiStore.showToast(`Added ${trimmed}`, 'success')
    await dataStore.loadAll()
    emit('close')
  } catch {
    uiStore.showToast('Failed to add player', 'error')
    saving.value = false
  }
}
</script>
