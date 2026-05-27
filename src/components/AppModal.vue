<template>
  <!--
    The .modal-backdrop is toggled via .active CSS class (not v-show) to preserve
    the CSS-driven display:flex and fadeUp animation defined in styles.css.
  -->
  <div
    class="modal-backdrop"
    :class="{ active: modalStore.content !== null }"
    @click.self="modalStore.close()"
  >
    <!-- eslint-disable-next-line vue/no-v-html — content is always our own HTML strings -->
    <div class="modal" v-html="modalStore.content"></div>
  </div>
</template>

<script setup>
import { useModalStore } from '../stores/modal.js'

const modalStore = useModalStore()
</script>
