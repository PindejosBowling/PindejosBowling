import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],

  // Must match the GitHub Pages repo path so all asset URLs resolve correctly.
  // The live site is at https://jordanreticker.github.io/PindejosBowling/
  base: '/PindejosBowling/',
})
