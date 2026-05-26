import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// Transitional plugin: app.js is a plain (non-module) script that Vite cannot
// bundle. Copy it verbatim into dist/ so it is available after deployment.
// Remove this plugin once app.js has been fully migrated to Vue components.
function copyLegacyScript() {
  return {
    name: 'copy-legacy-script',
    closeBundle() {
      copyFileSync(
        resolve(process.cwd(), 'app.js'),
        resolve(process.cwd(), 'dist/app.js')
      )
    },
  }
}

export default defineConfig({
  plugins: [vue(), copyLegacyScript()],

  // Must match the GitHub Pages repo path so all asset URLs resolve correctly.
  // The live site is at https://jordanreticker.github.io/PindejosBowling/
  base: '/PindejosBowling/',
})
