// src/stores/modal.js — modal content store (Task 6)
// Backs the AppModal component. Legacy code reaches it via window.openModal / window.closeModal,
// which App.vue exposes after mounting.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useModalStore = defineStore('modal', () => {
  /** Raw HTML string to display inside the modal, or null when closed. */
  const content = ref(null)

  /** Open the modal with an HTML string. */
  function open(html) {
    content.value = html
  }

  /** Close the modal. */
  function close() {
    content.value = null
  }

  return { content, open, close }
})
