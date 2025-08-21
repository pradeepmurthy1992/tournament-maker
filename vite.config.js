import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/tournament-maker/',   // <-- if your repo name differs, update this
  define: { 'process.env': {} } // helps some xlsx env warnings
})
