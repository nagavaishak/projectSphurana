import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Worker threads instead of the default forked processes — much cheaper
    // worker startup (the ~3.8× win; see docs/plans/features-test-suite-speedup.md).
    //
    // `isolate: false`: workers REUSE the module graph across files instead of
    // re-evaluating it ~518× per run. On CI's 4-vCPU runner this collapsed the
    // vitest `collect` phase from ~250s to ~14s — the dominant cost of the whole
    // `lint typecheck test` job (which was taking ~8 min, almost entirely this
    // suite). The prerequisite was canonicalising every shared/boundary module
    // any test mocks (database, observability, ai, storage, the push dispatchers,
    // …) behind a vite alias so a file-local `vi.mock` can't silently miss when
    // another file imported the real module first. Internal modules that must
    // stay test-controlled (e.g. the vertical-config registry) use a restored
    // `vi.spyOn` instead of `vi.mock`. See docs/plans/features-test-suite-speedup.md.
    // Verified non-flaky across fixed-order, shuffled, and single-thread
    // (maximal-shared-graph) runs.
    //
    // MAINTENANCE RULE: do NOT `vi.mock('<module with a canonical alias below>')`
    // in a test — under `isolate: false` that factory persists on the shared
    // worker graph and poisons every later test. Import the symbol and drive it
    // with `vi.mocked()`. To control an INTERNAL module, use a restored
    // `vi.spyOn` (keep the handle, call `.mockRestore()` in afterEach).
    pool: 'threads',
    isolate: false,
    // The pre-commit hook runs `turbo run test` across all packages at once;
    // combined with each vitest's own worker pool that oversubscribes the CPU,
    // the heavy tests here (large shared graph, some re-imported via
    // vi.resetModules) tip past the default 5s and flake — despite passing
    // reliably in isolation. Give them headroom so load, not correctness, stops
    // being the failure mode.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/packages/features',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/test-setup.ts'],
    },
    // Array form (`{ find, replacement }`) so the integrations *root* alias can
    // use an exact-match RegExp — a plain string alias prefix-matches, which
    // would wrongly redirect every `@borradh-workspace/integrations/<subpath>`
    // (including un-mocked ones like `/shared`, `/loops`, `/notion`) into the
    // root mock file. First match wins, so more-specific entries come first.
    alias: [
      // Allow schema imports (labels, enums) which are just constants - must come BEFORE general database alias
      {
        find: '@borradh-workspace/database/schema',
        replacement: path.resolve(__dirname, '../database/src/schema/index.ts'),
      },
      // Mock the database module to avoid needing DATABASE_URL in tests
      {
        find: '@borradh-workspace/database',
        replacement: path.resolve(__dirname, './src/__mocks__/database.ts'),
      },
      {
        find: '@borradh-workspace/storage',
        replacement: path.resolve(__dirname, './src/__mocks__/storage.ts'),
      },
      // Canonical boundary mock — see docs/plans/features-test-suite-speedup.md
      {
        find: '@borradh-workspace/redis',
        replacement: path.resolve(__dirname, './src/__mocks__/redis.ts'),
      },
      // Canonical boundary mock for BullMQ — avoids constructing a real Queue
      // (which opens a non-functional Redis connection and hangs on add()).
      {
        find: 'bullmq',
        replacement: path.resolve(__dirname, './src/__mocks__/bullmq.ts'),
      },
      // Canonical boundary mock — see docs/plans/features-test-isolation-windows.md
      {
        find: '@borradh-workspace/email',
        replacement: path.resolve(__dirname, './src/__mocks__/email.ts'),
      },
      // Canonical boundary mock for the AI/LLM package.
      {
        find: '@borradh-workspace/ai',
        replacement: path.resolve(__dirname, './src/__mocks__/ai.ts'),
      },
      // Canonical boundary mock for the PATIENT Better Auth instance. The real
      // module constructs a BA instance over the live `db` at import time, so
      // any test touching patient-auth would otherwise need a database — which
      // is why none of those services had tests at all.
      //
      // `@borradh-workspace/auth/magic-link-binding` is deliberately NOT
      // aliased: that module is pure crypto with no BA and no db, and it is
      // the control blocking cross-clinic magic-link replay, so tests get the
      // REAL implementation through the mock's re-export.
      // Resolve to SOURCE, not the mock and not dist: this is the real crypto
      // the mock re-exports, and dist is not built when the suite runs. Must
      // precede the `/patient` entry — first match wins, and a prefix match on
      // '@borradh-workspace/auth/patient' would not catch this specifier, but
      // keeping the more specific path first is the house rule here.
      {
        find: '@borradh-workspace/auth/magic-link-binding',
        replacement: path.resolve(
          __dirname,
          '../auth/src/magic-link-binding.ts'
        ),
      },
      {
        find: '@borradh-workspace/auth/patient',
        replacement: path.resolve(__dirname, './src/__mocks__/auth-patient.ts'),
      },
      // Canonical boundary mock for observability — replaces the former global
      // `vi.mock` in test-setup.ts. The real package (Pino + Better Stack +
      // Sentry + PostHog) is never loaded; tracked* wrappers are passthroughs.
      {
        find: '@borradh-workspace/observability',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/observability.ts'
        ),
      },
      // Canonical boundary mock for `node:dns/promises`. Both html.test.ts and
      // analyze-website.test.ts mock DNS for the SSRF guard; under `isolate: false`
      // two file-local `vi.mock('node:dns/promises')` factories collided on the
      // shared worker graph and flaked html.ts's DNS tests by file order. Exact-
      // match RegExp so only the bare builtin specifier is redirected.
      {
        find: /^node:dns\/promises$/,
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/node-dns-promises.ts'
        ),
      },
      // Push dispatchers — internal SDK wrappers that no test exercises for
      // real. The real `send-push-notification` service is pulled into the
      // shared worker graph by other services' tests, so a per-file `vi.mock`
      // leaks under `isolate: false`. Alias the exact relative specifier (only
      // that service imports `./dispatch-{expo,fcm,apns}.js`) to a canonical
      // mock so the real SDK wrappers (`new Expo()`, firebase-admin, APNs HTTP/2)
      // never load. Exact-match RegExp so the WHOLE specifier is replaced.
      {
        find: /^\.\/dispatch-(expo|fcm|apns)\.js$/,
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/push-dispatchers.ts'
        ),
      },
      // env subpaths — config, aliased to static fake objects (not vi.fn()s).
      {
        find: '@borradh-workspace/env/api',
        replacement: path.resolve(__dirname, './src/__mocks__/env-api.ts'),
      },
      {
        find: '@borradh-workspace/env/voice',
        replacement: path.resolve(__dirname, './src/__mocks__/env-voice.ts'),
      },
      {
        find: '@borradh-workspace/env/storage',
        replacement: path.resolve(__dirname, './src/__mocks__/env-storage.ts'),
      },
      {
        find: '@borradh-workspace/env/auth',
        replacement: path.resolve(__dirname, './src/__mocks__/env-auth.ts'),
      },
      // integrations subpaths — MUST come BEFORE the root
      // '@borradh-workspace/integrations' alias so the more-specific paths win
      // (same ordering rule as database/schema vs database above).
      {
        find: '@borradh-workspace/integrations/encryption',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-encryption.ts'
        ),
      },
      {
        find: '@borradh-workspace/integrations/meta-capi',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-meta-capi.ts'
        ),
      },
      // Meta owned-domains (domain verification). Aliased for the same reason
      // as meta-capi: no test may reach graph.facebook.com, and one shared
      // instance is the prerequisite for `isolate: false`.
      {
        find: '@borradh-workspace/integrations/meta-domains',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-meta-domains.ts'
        ),
      },
      {
        find: '@borradh-workspace/integrations/meta-ads',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-meta-ads.ts'
        ),
      },
      {
        find: '@borradh-workspace/integrations/stripe',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-stripe.ts'
        ),
      },
      {
        find: '@borradh-workspace/integrations/meta-messaging',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-meta-messaging.ts'
        ),
      },
      {
        find: '@borradh-workspace/integrations/whatsapp',
        replacement: path.resolve(
          __dirname,
          './src/__mocks__/integrations-whatsapp.ts'
        ),
      },
      // integrations root — exact-match RegExp so it does NOT swallow un-mocked
      // subpaths (`/shared`, `/loops`, `/notion`, ...). MUST come AFTER every
      // integrations subpath above.
      {
        find: /^@borradh-workspace\/integrations$/,
        replacement: path.resolve(__dirname, './src/__mocks__/integrations.ts'),
      },
      {
        find: '@borradh-workspace/testing',
        replacement: path.resolve(__dirname, '../testing/src/index.ts'),
      },
      // `@borradh-workspace/labels` is a pure-constants package (label records +
      // value arrays, no side effects) — alias to the REAL source (like
      // database/schema and testing above) so every test sees the FULL set of
      // constants. Several tests previously did a file-local `vi.mock(labels)`
      // exporting only a tiny subset (e.g. `{ countryCodeValues }`); under
      // `isolate: false` that clobbered the shared module so any other file
      // needing e.g. `userColorValues` got "No 'userColorValues' export is
      // defined on the mock". Constants never need mocking — point at real.
      {
        find: '@borradh-workspace/labels',
        replacement: path.resolve(__dirname, '../labels/src/index.ts'),
      },
    ],
  },
});
