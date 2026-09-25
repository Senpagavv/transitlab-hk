import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre starts its worker as an ES module worker.
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true, // never silently move to another port; the launcher opens 5173
    // During development, forward /api calls to the FastAPI backend.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
