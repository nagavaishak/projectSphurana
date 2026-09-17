import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // ffmpeg remux/probe tests shell out to real binaries and flake past the
    // default 5s when the pre-commit hook runs every package's suite at once
    // and oversubscribes the CPU. Give them headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
  },
});
