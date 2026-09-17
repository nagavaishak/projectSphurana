import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    // Ensures DATABASE_URL exists so the RLS specs that import the real
    // client/rls-context can COLLECT (they then skip unless the RLS role URLs
    // are set). A real DATABASE_URL takes precedence.
    setupFiles: ['./src/__tests__/test-env-setup.ts'],
  },
});
