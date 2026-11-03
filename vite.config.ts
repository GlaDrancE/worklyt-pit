import { defineConfig } from "vitest/config";

// SINGLE_FILE=1 builds one JS file (used to pack the game into a single page for previews).
const single = process.env.SINGLE_FILE === "1";

export default defineConfig({
  // Relative base so the build works on GitHub Pages / Cloudflare Pages sub-paths.
  base: "./",
  assetsInclude: ["**/*.glb"],
  build: { chunkSizeWarningLimit: 1500, ...(single ? { rolldownOptions: { output: { codeSplitting: false } } } : {}) },
  test: {
    // The lap-simulation integration tests run real physics for 240 s of simulated time,
    // which takes longer than Vitest's 5 s default. Keep the suite reliable in CI.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
