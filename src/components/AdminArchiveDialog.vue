<template>
  <Teleport to="body">
    <div class="modal-backdrop active" @click.self="!saving && $emit('close')">
      <div class="modal">
        <div class="modal-title">Archive &amp; Advance Week?</div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:16px;">
          Saves this week's scores to your archive, increments the week, and clears the scoreboard.
        </p>
        <div class="btn-row">
          <button class="btn" :disabled="saving" @click="$emit('close')">Cancel</button>
          <button class="btn primary" :disabled="saving" @click="confirm">
            {{ saving ? 'Archiving…' : 'Archive & Advance' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import { useDataStore } from '../stores/data.js'
import { apiPost } from '../api.js'

const emit = defineEmits(['close'])

const dataStore = useDataStore()
const saving    = ref(false)

async function confirm() {
  saving.value = true
  try {
    const r = await apiPost('archiveAndAdvance')
    if (r.error) { window.toast?.(r.error, 'error'); saving.value = false; return }
    window.toast?.(`Saved ${r.rowsAdded} rows`, 'success')
    await dataStore.loadAll()
    emit('close')
  } catch {
    window.toast?.('Archive failed', 'error')
    saving.value = false
  }
}
</script>
