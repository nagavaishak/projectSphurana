/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The plain project: pure modules and React island tests.
 *
 * Deliberately NOT wrapped in Astro's `getViteConfig` — that pulls in the
 * app's integrations and resolves React through Astro's SSR conditions, which
 * hands these tests a second copy of React (`Cannot read properties of null
 * (reading 'useMemo')`). The one test that needs to COMPILE `.astro` files
 * lives in its own project instead; see vitest.astro.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'unit',
    // Node by default — most tests here are pure modules. Component tests opt
    // into jsdom per file with a `@vitest-environment jsdom` docblock, so the
    // fast majority don't pay for a DOM they never touch.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'src/**/*.render.test.ts'],
  },
});
