import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/tournament-maker/',
  define: { 'process.env': {} } // <-- add this line
})
