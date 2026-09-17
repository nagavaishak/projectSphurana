import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// .env.staging when E2E_ENV=staging, otherwise .env.test.
const envFile =
  process.env.E2E_ENV === 'staging' ? '.env.staging' : '.env.test';
dotenv.config({ path: envFile });

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
const skipWebServer = process.env.SKIP_WEBSERVER === 'true';

/**
 * Playwright config for @borradh-workspace/marketing-astro.
 *
 * Modeled on apps/app-e2e + .github/workflows/e2e-preview.yml — the suite
 * targets a *deployed* environment and never boots a backend of its own:
 *
 *   - CI: SKIP_WEBSERVER=true, BASE_URL = the Vercel preview. That preview's
 *     booking widget already talks to the per-PR Fly API created by
 *     pr-preview.yml — the suite just reuses it.
 *   - Local: `webServer` starts `astro dev` for the marketing app. To run
 *     the booking spec, point API_URL in .env.test at an existing API
 *     (a Fly preview / staging) — `astro dev` bakes it into the app.
 */
export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : 'list',
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // CI targets Vercel previews behind Deployment Protection. Send the
    // automation bypass as a header so it rides every navigation — a
    // query-string bypass is dropped on the first relative goto().
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass':
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
  },

  projects: [
    {
      name: 'smoke-tests',
      testMatch: /src\/smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The booking flow — moved here from apps/app-e2e when the wizard was
      // ported to marketing-astro and hung off the microsite base. Same shape
      // as portal-tests: no storageState (booking is public, so a spec that
      // passed on inherited auth would prove nothing), staff-side seeding over
      // pure HTTP against API_URL.
      //
      // This replaced a single thin spec keyed on TEST_BOOKING_ORG_SLUG that
      // skipped whenever the variable was unset — i.e. by default. These seed
      // the org, the service and the availability they need, so they cannot
      // skip and cannot pass vacuously.
      name: 'booking-tests',
      testMatch: /src\/booking\/.*\.spec\.ts/,
      timeout: 180_000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Customer portal — moved here from apps/app-e2e when the portal was
      // ported to marketing-astro. No storageState: the portal is public, so
      // every spec earns its own session in a clean context. Staff-side
      // seeding is pure HTTP against API_URL (which must be the same API the
      // target deployment proxies /api/* to) — see
      // src/fixtures/portal-seed.fixture.ts.
      name: 'portal-tests',
      testMatch: /src\/portal\/.*\.spec\.ts/,
      timeout: 120_000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Microsite LCP budget (plan §9). Opt-in: the spec skips itself unless
      // MICROSITE_PERF_URL names a published microsite page, so it never runs
      // — and so can never flake — in the default PR suite. Deliberately NOT
      // in the default `e2e` run either; invoke it explicitly.
      //
      // Chromium only: the measurement uses CDP network + CPU throttling,
      // which has no equivalent in the other engines.
      //
      //   MICROSITE_PERF_URL=https://<preview>/... pnpm e2e:perf
      name: 'perf-tests',
      testMatch: /src\/perf\/.*\.spec\.ts/,
      timeout: 180_000,
      retries: 0,
      use: { ...devices['Desktop Chrome'], trace: 'off', video: 'off' },
    },
  ],

  // Local convenience only — boots the marketing app's dev server. Never
  // an API: in CI the deployed preview is targeted directly.
  webServer: skipWebServer
    ? undefined
    : {
        command: 'pnpm --filter @borradh-workspace/marketing-astro dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
