import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// SINGLE_FILE=1 builds one JS file (used to pack the game into a single page for previews).
const single = process.env.SINGLE_FILE === "1";
const input = single
  ? resolve(process.cwd(), "index.html")
  : { main: resolve(process.cwd(), "index.html"), admin: resolve(process.cwd(), "admin.html") };

export default defineConfig({
  // Relative base so the build works on GitHub Pages / Cloudflare Pages sub-paths.
  base: "./",
  assetsInclude: ["**/*.glb"],
  build: {
    chunkSizeWarningLimit: 1500,
    rolldownOptions: { input, ...(single ? { output: { codeSplitting: false } } : {}) },
  },
  test: {
    // The lap-simulation integration tests run real physics for ~240 s of simulated time,
    // which takes longer than Vitest's 5 s default. Keep the suite reliable in CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: []
});
