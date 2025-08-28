import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoName = "tournament-maker"; // <-- replace with your repo

export default defineConfig({
  base: `/${repoName}/`,
  plugins: [react()],
});
