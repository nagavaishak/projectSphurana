import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Component/unit test runner for apps/app. Deliberately separate from
// vite.config.ts: tests don't need the TanStack Router codegen plugin, the
// runtime-config dev middleware, or the VITE_ env injection — a lean jsdom
// setup keeps them fast and hermetic. Router-coupled components mock
// '@tanstack/react-router' per-test (see src/test/render.tsx notes).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Pin the runner to UTC so date/time specs are deterministic regardless of
    // the developer's local zone. Many specs build fixtures with midnight-UTC
    // literals (`new Date('2026-07-22T00:00:00Z')`) and assert the calendar day;
    // west-of-UTC machines otherwise render that instant on the previous day and
    // the spec flakes locally while passing on CI (which already runs UTC).
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // The *-parity specs drive several real forms per test with userEvent,
    // which types on real timers. Under CI's parallelism that lands well past
    // vitest's 5s default (the three-surface social-post spec runs ~0.7s here,
    // >5s there), so give the whole jsdom suite headroom.
    testTimeout: 30_000,
  },
});
