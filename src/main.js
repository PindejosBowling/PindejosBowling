// Vite / Vue entry point.
// Minimal scaffold — expanded during the Vue migration described in ANTIPATTERNS.md.
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.mount('#vue-app')
