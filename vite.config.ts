import { defineConfig } from "vite";

// SINGLE_FILE=1 builds one JS file (used to pack the game into a single page for previews).
const single = process.env.SINGLE_FILE === "1";

export default defineConfig({
  // Relative base so the build works on GitHub Pages / Cloudflare Pages sub-paths.
  base: "./",
  assetsInclude: ["**/*.glb"],
  build: { chunkSizeWarningLimit: 1500, ...(single ? { rolldownOptions: { output: { codeSplitting: false } } } : {}) },
});
