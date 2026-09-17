/**
 * Canonical mock for `@borradh-workspace/env/auth`.
 *
 * Aliased in vite.config.ts so tests never run the real `createEnv`, and so
 * every test file sees the *same* config object — a prerequisite for
 * `isolate: false`. See docs/plans/features-test-suite-speedup.md.
 */
export const authEnv = {
  WEB_URL: 'https://mock-web.example.com',
  // Distinct from WEB_URL on purpose: in prod WEB_URL is the marketing site
  // and APP_URL is the dashboard SPA, so links to in-app routes must differ.
  APP_URL: 'https://mock-app.example.com',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-32-chars',
  BETTER_AUTH_URL: 'https://mock-web.example.com',
};
