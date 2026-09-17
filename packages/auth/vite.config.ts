import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    alias: [
      // The env package validates a long list of required vars at import time.
      // Aliasing it keeps these tests runnable with no environment at all,
      // which matters because the module under test — the magic-link org
      // binding — reads BETTER_AUTH_SECRET.
      {
        find: '@borradh-workspace/env/auth',
        replacement: path.resolve(__dirname, './src/__mocks__/env-auth.ts'),
      },
    ],
  },
});
