import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In ontwikkeling praat het scherm met de backend op 5101 (dotnet run); in productie
// doet nginx dat (nginx/nginx.conf).
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { port: 5175, proxy: { '/api': 'http://localhost:5101' } },
  build: {
    // Leaflet is een derde van de bundel en verandert nooit; apart houden scheelt
    // de bezoeker een download bij elke uitrol van de eigen code.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/leaflet') ? 'leaflet' : undefined),
      },
    },
  },
})
