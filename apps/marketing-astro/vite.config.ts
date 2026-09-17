/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Vitest-only config. Astro owns the app build (astro.config.mjs).
//
// Two projects, because they need incompatible Vite setups: `unit` runs pure
// modules and React islands on a plain config, `astro-render` needs Astro's
// own config to compile `.astro` files, and that config resolves React through
// SSR conditions that break the island tests.
export default defineConfig({
  test: {
    projects: ['./vitest.unit.config.ts', './vitest.astro.config.ts'],
  },
});
