import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load env file: .env.staging when E2E_ENV=staging, otherwise .env.test
const envFile =
  process.env.E2E_ENV === 'staging' ? '.env.staging' : '.env.test';
dotenv.config({ path: envFile });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const skipWebServer = process.env.SKIP_WEBSERVER === 'true';
const isStaging = process.env.E2E_ENV === 'staging';

/**
 * True when the target API/worker are running the Meta contract fake
 * (`META_E2E_STUB=true`, set by pr-preview.yml on both Fly apps).
 *
 * The connected projects are constrained by REAL Meta, not by anything about
 * our own code:
 *   - `connected-ads` runs serially with `retries: 0` because parallel ad
 *     launches trip Meta's user-level rate limit (error code 17), and a retry
 *     just digs the shared org deeper into it.
 *
 * Against the fake neither constraint exists — Meta is deterministic and
 * in-process — so those projects can run parallel. They do NOT get the global
 * `retries: 2`: determinism cuts both ways, and a retry that can't fix a Meta
 * problem can only re-roll ours and relabel a real bug "flaky". See the
 * `connected-ads` project. The NIGHTLY runs unstubbed against the real org and
 * keeps the safe settings.
 *
 * Deliberately `=== 'true'` rather than a truthiness check: the string
 * "false" is truthy, and a host that explicitly disables the stub must not
 * silently enable parallel ad launches against real Meta.
 */
const metaStubbed = process.env.META_E2E_STUB === 'true';

const BASE_AUTH_FILE = '.auth/base.json'; // Bootstrapped by globalSetup
const BARE_AUTH_FILE = '.auth/bare-user.json';
const CONNECTED_AUTH_FILE = '.auth/connected-user.json';

/**
 * Playwright config for apps/app (Vite SPA + Capacitor wrapper).
 *
 * Differences from apps/web-e2e:
 *   - Targets the Vite dev server at :5173 (or :4173 for `vite preview`)
 *   - apps/app is a pure SPA, so Playwright's default 'load' is fine
 *     (no `waitUntil: 'domcontentloaded'` workaround needed)
 *   - Cookie-session auth on the web (see `apps/app/src/lib/api-client.ts`
 *     — `authProvider` is only set on native Capacitor). The setup-bare /
 *     setup-connected projects sign in once via the UI and persist the
 *     session cookies into storageState for every dependent project.
 */
export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  workers: process.env.CI ? 4 : 2,

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    // MACHINE-READABLE RESULTS — the input for flake measurement.
    //
    // Every per-test outcome already exists in this run; until now the only
    // durable record was the `list` reporter's text in the CI log. Measuring
    // flake from that means regex-scraping logs, which is genuinely unreliable:
    // the log format has changed at least twice (the `✘ N [project] › spec` and
    // `N) [project] › spec` variants coexist), so a scraper silently
    // under-reports whichever format it wasn't written against.
    //
    // The JSON reporter gives per test: file, project, title, status, RETRY
    // COUNT, duration and error. That last one is the whole game — `retries: 2`
    // in CI means Playwright ALREADY re-runs failures, so
    // `status === 'passed' && retry > 0` is the textbook definition of a flaky
    // test, computed for us and currently thrown away.
    //
    // Written into `test-results/`, which CI already uploads as an artifact, so
    // this needs no workflow change to become retrievable.
    ['json', { outputFile: 'test-results/results.json' }],
    ...(process.env.CI ? [['github'] as const] : []),
  ],

  // VISUAL BASELINES — one set, keyed by project + viewport, NOT by platform.
  //
  // Playwright's default template includes the OS, which invites a macOS
  // baseline to be committed from a laptop and then never match CI: font
  // hinting and subpixel antialiasing differ between platforms. Baselines are
  // captured ONLY in the CI Linux container (the `visual` job, mode=bootstrap),
  // and committed under src/visual/__screenshots__ — which is exactly the path
  // the workflow's auto-heal/bootstrap steps add + commit.
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Antialiasing on text edges moves a handful of channel values between
      // otherwise identical renders. `maxDiffPixelRatio` scales with surface
      // size (a fixed pixel count would be strict on a small card and permissive
      // on a full-page dashboard). Deliberately TIGHT: a noisy diff is a
      // determinism bug to fix in src/visual/determinism.ts or mask, NOT a
      // threshold to loosen — loosening is how a visual suite quietly dies.
      maxDiffPixelRatio: 0.002,
      threshold: 0.15,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  // Global setup: writes the base storageState. apps/app has no cookie
  // banner so this is lighter than web-e2e's equivalent.
  globalSetup: './src/global-setup.ts',
  // Global teardown: cleans up `e2e.test.%` rows. Skipped on staging.
  globalTeardown: './src/global-teardown.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    storageState: BASE_AUTH_FILE,
    // The in-runner lane serves the SPA as https://app-e2e.borradh.io with a
    // self-signed cert, so the browser sends a Referer that origin-restricted
    // third parties (Google Maps, Turnstile, the Meta JS SDK) actually accept —
    // on http://localhost they reject it and the feature silently disappears.
    // Opt-in via env so the preview lane keeps validating real certificates.
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === 'true',
    // CI hits Vercel previews behind Deployment Protection. Pass the
    // automation bypass as a header so every navigation carries it —
    // a query-string bypass would be lost the moment a test does
    // page.goto('/'), which resolves against baseURL and drops the query.
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
    // ============================================
    // AUTH TESTS - Run WITHOUT stored auth state
    // These test the actual auth flows (sign-in, sign-up, etc.)
    // sign-in test needs setup-bare so the test user exists
    // ============================================
    {
      name: 'auth-tests',
      testMatch: /src\/auth\/.*\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // SMOKE TESTS - Run WITHOUT stored auth state
    // These test critical paths including auth
    // ============================================
    {
      name: 'smoke-tests',
      testMatch: /src\/smoke\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // JOURNEY TESTS - Local only (need testing endpoints)
    // Complete multi-step user workflows with real data
    // ============================================
    ...(isStaging
      ? []
      : [
          {
            name: 'journey-tests',
            testMatch: /src\/journeys\/.*\.spec\.ts/,
            fullyParallel: false,
            use: { ...devices['Desktop Chrome'] },
          },
        ]),

    // ============================================
    // SETUP - Bare org (no Meta integration)
    // Signs in through real UI — no testing endpoints needed
    // ============================================
    {
      name: 'setup-bare',
      testMatch: /setup-bare\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // SETUP - Connected org (Meta + Instagram)
    // Signs in through real UI — no testing endpoints needed
    // ============================================
    {
      name: 'setup-connected',
      testMatch: /setup-connected\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // ADMIN TESTS - Mix of bare-user (negative case) +
    // optional admin user (positive case, skipped if creds missing)
    // ============================================
    {
      name: 'admin-tests',
      testMatch: /src\/admin\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: { ...devices['Desktop Chrome'] },
    },

    // ============================================
    // AUTHENTICATED TESTS - Use bare org auth state
    // All other tests that require logged-in user. Excludes the special
    // projects above and *.connected.spec.ts (which use connected org auth).
    // Also excludes everything under src/real/ — those drive real renders and
    // run single-worker in the `real-e2e` project to avoid render-queue
    // contention. (The deprecated create-all-templates.spec.ts is skipped at
    // the describe level, so no project needs to exclude it.)
    // Also excludes src/mobile/ — those run under the `authenticated-mobile`
    // project on a mobile device descriptor (Pillar 2 of the release-safety
    // strategy) so they don't also execute on the desktop viewport here.
    // ============================================
    {
      name: 'authenticated',
      testMatch:
        /src\/(?!auth\/)(?!smoke\.)(?!admin\.)(?!journeys\/)(?!real\/)(?!mobile\/)(?!visual\/)(?!a11y\/).*(?<!\.connected)\.spec\.ts/,
      // Tab-organized suites bring their own per-test-org auth (the `org`
      // fixture), so they run in the `tabs` project below — NOT here (this
      // project shares one bare org via storageState). The QA-consolidation
      // lanes (visual pixel-diff, a11y/axe, Claire grounding) each run in their
      // OWN project below and are excluded here so they never gate the required
      // authenticated suite.
      testIgnore:
        /setup-bare\.ts|setup-connected\.ts|src\/real\/|src\/mobile\/|src\/visual\/|src\/a11y\/|src\/assistant\/claire-grounding\.spec\.ts|src\/(calendar|sales|catalog|clients|team|settings|home|inbox|navigation)\//,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: BARE_AUTH_FILE,
      },
    },

    // ============================================
    // VISUAL - pixel-diff regression over the generated route inventory
    // (src/visual/routes.ts). Runs desktop + mobile; diffs against approved
    // baselines. retries: 0 on purpose — a flaky visual suite hides real
    // regressions behind a green re-run; non-determinism is a bug to fix at
    // source (see src/visual/determinism.ts), never to paper over. Isolated
    // from `authenticated` above so it never gates the required suite.
    // ============================================
    {
      name: 'visual',
      testMatch: /src\/visual\/.*\.spec\.ts/,
      retries: 0,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: BARE_AUTH_FILE,
        colorScheme: 'light',
        // Viewport is set per-test (desktop + mobile both run here); this is
        // only the starting size.
        viewport: { width: 1440, height: 900 },
      },
    },

    // ============================================
    // A11Y - advisory axe-core WCAG scan over the bare-org surfaces
    // (src/a11y/). Never blocks; the workflow treats it as advisory. Isolated
    // from `authenticated` so a new violation can't fail the required suite.
    // ============================================
    {
      name: 'a11y',
      testMatch: /src\/a11y\/.*\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: BARE_AUTH_FILE,
      },
    },

    // ============================================
    // GROUNDING - Claire "real messages" grounding checks
    // (src/assistant/claire-grounding.spec.ts). Sends actual messages through
    // the real tool loop and asserts against seeded DB state — slow and
    // model-driven, so retries: 0 (a retry re-rolls the model, not a fix) and
    // its OWN project, excluded from the required `authenticated` suite.
    // ============================================
    {
      name: 'grounding',
      testMatch: /src\/assistant\/claire-grounding\.spec\.ts/,
      retries: 0,
      timeout: 120_000,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: BARE_AUTH_FILE,
      },
    },

    // ============================================
    // TABS - Per-test-org, organized by sidebar tab.
    // Each spec under a tab dir (calendar/sales/catalog/clients/team/settings/
    // home/inbox) provisions its OWN verified org via the `org` fixture and
    // signs in as its owner — no shared storageState, no setup dependency, so
    // the suite is order-independent and fullyParallel. In CI these are sharded
    // one job per tab dir.
    // ============================================
    {
      name: 'tabs',
      testMatch:
        /src\/(calendar|sales|catalog|clients|team|settings|home|inbox|navigation)\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    // Same tab specs at a mobile viewport (Pixel 7). The `org` fixture forwards
    // the project's device options, so these run at 412px with isMobile/hasTouch
    // — catching responsive/layout regressions on the same surfaces without the
    // native Maestro lane. Specs whose assertions are viewport-specific should
    // guard on `testInfo.project.name` or use viewport-agnostic checks.
    {
      name: 'tabs-mobile',
      testMatch:
        /src\/(calendar|sales|catalog|clients|team|settings|home|inbox|navigation)\/.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
      },
    },

    // ============================================
    // AUTHENTICATED MOBILE TESTS - Use bare org auth state on a mobile
    // viewport (Pixel 7). Pillar 2 of docs/testing/release-safety-strategy.md:
    // a real-path mobile-viewport lane catches mobile-only regressions
    // (e.g. campaign pause on a phone, uploaded-vs-generated selection on a
    // small screen) without standing up the native Maestro train. Specs live
    // under src/mobile/ and are excluded from the desktop `authenticated`
    // project above so each mobile spec runs exactly once, on the phone
    // descriptor. Shares the bare-org auth state, so it runs in the bare suite.
    // ============================================
    {
      name: 'authenticated-mobile',
      testMatch: /src\/mobile\/.*\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Pixel 7'],
        storageState: BARE_AUTH_FILE,
      },
    },

    // ============================================
    // REAL E2E TESTS - Single-worker, bare org
    // Everything under src/real/ drives a real render end to end: the Socials
    // "Create Post" video/graphic dialogs and the monthly content batch, each
    // hitting Remotion Lambda / the Fabric worker + render queue. Running
    // alongside the parallel `authenticated` workers starves the queue, so a
    // render never completes within the timeout. Isolating to one worker keeps
    // the queue serialized. Uses bare-org auth, so it runs in the bare suite.
    // ============================================
    {
      name: 'real-e2e',
      testMatch: /src\/real\/.*\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      // No retries: every attempt is a real billed render (gemini-3-pro-image
      // / Remotion Lambda). The global `retries: 2` would triple the spend on
      // a flaky render for no extra signal, so override to 0 here.
      retries: 0,
      timeout: 10 * 60 * 1000,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-bare'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: BARE_AUTH_FILE,
      },
    },

    // ============================================
    // CONNECTED TESTS - Meta-connected org
    // Matches *.connected.spec.ts OUTSIDE src/chatbots/ and src/ads/
    // Can run in parallel — these don't modify shared org settings
    // ============================================
    {
      name: 'connected',
      testMatch: /\.connected\.spec\.ts/,
      testIgnore: /src\/chatbots\/|src\/ads\//,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-connected'],
      timeout: 600_000, // 10 min per test
      use: {
        ...devices['Desktop Chrome'],
        storageState: CONNECTED_AUTH_FILE,
        actionTimeout: 30_000,
      },
    },

    // ============================================
    // CONNECTED ADS TESTS - Serial execution
    // Every ad launch makes many Meta API calls; running them in parallel
    // trips the user-level rate limit (code 17). Enforce serial cross-file
    // execution with: --project=connected-ads --workers=1
    // ============================================
    {
      name: 'connected-ads',
      testMatch: /src\/ads\/.*\.connected\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-connected'],
      timeout: 600_000,
      // Serial + no-retry ONLY against real Meta. Every ad publish hits the
      // Marketing API, and when Meta rate-limits the org a retry can't succeed
      // — it just fires another batch of calls and digs the org deeper in.
      // Rate-limited publishes are detected via skipIfMetaRateLimited().
      //
      // Against the contract fake there is no rate limiter and no shared org,
      // so this is the single biggest wall-clock win available here: the ads
      // specs stop running one-at-a-time.
      fullyParallel: metaStubbed,
      // ONE retry against the fake, not the global two.
      //
      // A retry exists to ride out something external and transient. Against
      // the fake, Meta is deterministic and in-process, so a retry cannot fix a
      // Meta problem — it can only re-roll OUR bug and, when the re-roll
      // passes, relabel it "flaky". Not hypothetical: the run that found the
      // per-process store bug reported edit-ad and render-to-live-ad as
      // "2 flaky" — they passed once they happened to hit the machine holding
      // the state — and turned a 5-minute spec into 15.
      //
      // One is kept for genuine browser / preview-infra flake, which is real
      // and has nothing to do with Meta. Zero against real Meta, where a retry
      // digs a rate-limited org deeper in.
      retries: metaStubbed ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        storageState: CONNECTED_AUTH_FILE,
        actionTimeout: 30_000,
      },
    },

    // ============================================
    // CONNECTED CHATBOT TESTS - Serial execution
    // Chatbot tests modify shared org settings (targeting, system prompt,
    // calendar type). They MUST run one file at a time to avoid race conditions.
    // Runs after the parallel connected project finishes.
    // ============================================
    {
      name: 'connected-chatbot',
      testMatch: /src\/chatbots\/.*\.connected\.spec\.ts/,
      dependencies: process.env.PW_SKIP_DEPS ? [] : ['setup-connected'],
      timeout: 600_000,
      fullyParallel: false,
      // Playwright has no per-project workers setting. To enforce serial
      // cross-file execution, use: --project=connected-chatbot --workers=1
      use: {
        ...devices['Desktop Chrome'],
        storageState: CONNECTED_AUTH_FILE,
        actionTimeout: 30_000,
      },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : [
        {
          command: 'pnpm turbo dev --filter=@borradh-workspace/api',
          url: `${API_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'pnpm turbo dev --filter=@borradh-workspace/app',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
