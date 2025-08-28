// vite.config.js (ESM)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ⚠️ CHANGE repoName to your repo name exactly
const repoName = "tournament-maker"; // <-- e.g., "my-repo"

export default defineConfig({
  base: `/${repoName}/`,
  plugins: [react()],
});
