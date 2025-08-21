import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: if your repo is NOT named "tournament-maker",
// change the base to '/<your-repo-name>/'
export default defineConfig({
  plugins: [react()],
  base: '/tournament-maker/',
})
