/**
 * Canonical mock for `@borradh-workspace/env/auth`, aliased in vite.config.ts.
 *
 * The real `createEnv` validates a long list of required vars at import time,
 * so without this these tests would need a full environment to assert pure
 * crypto. Mirrors the equivalent mock in packages/features.
 */
export const authEnv = {
  WEB_URL: 'https://mock-web.example.com',
  APP_URL: 'https://mock-app.example.com',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-32-chars',
  BETTER_AUTH_URL: 'https://mock-web.example.com',
};
