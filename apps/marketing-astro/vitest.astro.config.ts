/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';

/**
 * The one project that COMPILES `.astro` components so a test can render them.
 *
 * It exists for `published-render.render.test.ts`, which asserts §1 of the
 * inline edit contract on the actual HTML a published microsite emits. Grepping
 * the source would only prove a string is absent from a file; this proves it is
 * absent from the output.
 *
 * Isolated in its own project because `getViteConfig` breaks the React island
 * tests (two copies of React) — see vitest.unit.config.ts.
 */
/*
 * `getViteConfig` types its argument as Astro's ViteUserConfig, which knows
 * nothing about Vitest's `test` key — hence the cast. The key IS honoured at
 * runtime (Astro merges the object straight into the Vite config).
 */
const config = {
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'astro-render',
    environment: 'node',
    include: ['src/**/*.render.test.ts'],
  },
};

export default getViteConfig(config as Parameters<typeof getViteConfig>[0]);
