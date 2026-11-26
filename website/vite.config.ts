import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/riddle-notes/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        stats: 'stats.html'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})
