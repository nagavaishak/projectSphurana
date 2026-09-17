/* eslint-disable */
/**
 * Jest config for INTEGRATION tests (*.int-spec.ts).
 *
 * Separate from jest.config.ts (unit tests with a mocked db) so the two never
 * collide. This config:
 *   - matches only `*.int-spec.ts`
 *   - starts a real Postgres testcontainer in globalSetup and migrates it
 *   - sets process.env.DATABASE_URL per-worker (setupFiles) before the db
 *     singleton is imported
 *   - runs serially (maxWorkers: 1) against the single shared container
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);
swcJestConfig.swcrc = false;
// Emit CommonJS for the integration suite. globalSetup/globalTeardown are
// loaded by jest's own (CJS) module loader, which chokes on SWC's default ES6
// output ("exports is not defined in ES module scope"). CJS output works for
// both the infra files and the *.int-spec.ts files (workspace deps resolve to
// CJS dist; ESM-only deps like testcontainers/drizzle are pulled in via
// dynamic import or interop).
swcJestConfig.module = { ...(swcJestConfig.module ?? {}), type: 'commonjs' };

export default {
  displayName: '@borradh-workspace/api:integration',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleNameMapper: {
    // Stub better-auth (ESM-only, pulls Redis/session wiring). AuthGuard is
    // overridden in the harness so the real `auth` object is never used.
    '^@borradh-workspace/auth/server$':
      '<rootDir>/src/_integration/__mocks__/auth-server.ts',
    // The SECOND better-auth instance (patient portal, ENG-647) needs the same
    // stub: it is ESM-only too, and it reaches this harness transitively via
    // features/appointments → send-appointment-reminder → patient-auth, so an
    // un-stubbed import fails MOST suites at load, not just portal ones.
    '^@borradh-workspace/auth/patient$':
      '<rootDir>/src/_integration/__mocks__/auth-patient.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The real database schema (loaded here, unlike the unit suite which mocks
  // db) pulls in ESM-only deps via the built dist. Jest ignores node_modules
  // for transforms by default; allow SWC to transform the ESM-only packages in
  // the chain so they can be required from CJS.
  // The real database/env/features dist (loaded here, unlike the unit suite
  // which mocks db) pulls in ESM-only packages that must be SWC-transformed to
  // be require()-able from CJS. Allowlist them (transform = NOT ignored).
  // Everything else in node_modules stays ignored (transforming all of it
  // breaks already-CJS packages that use private fields).
  transformIgnorePatterns: [
    // `postgres` ships CJS and must NOT be transformed. It is named explicitly
    // because the .pnpm rule below only covers pnpm's virtual store: when the
    // checkout sits under another checkout (a git worktree), Node resolves it
    // from the ANCESTOR `node_modules`, that path misses the rule entirely, and
    // SWC then fails to parse it — the suite dies in globalSetup.
    '/node_modules/postgres/',
    `node_modules/\\.pnpm/(?!(${[
      '@paralleldrive\\+cuid2',
      '@noble\\+hashes',
      '@t3-oss\\+env-core',
      'nanoid',
    ].join('|')})@)`,
  ],
  testMatch: ['**/*.int-spec.ts'],
  setupFiles: ['<rootDir>/src/_integration/setup-after-env.ts'],
  // Per-file afterAll that quits the shared ioredis singleton BEFORE
  // global-teardown stops the Redis container — otherwise the retry-forever
  // connection error-loops on ECONNREFUSED once the container is gone and flips
  // the suite's exit code to 1 even when every test passed.
  setupFilesAfterEnv: [
    '<rootDir>/src/_integration/mock-observability.ts',
    '<rootDir>/src/_integration/close-connections.ts',
  ],
  globalSetup: '<rootDir>/src/_integration/global-setup.ts',
  globalTeardown: '<rootDir>/src/_integration/global-teardown.ts',
  // One shared container; run serially to keep DB state predictable.
  maxWorkers: 1,
  // Container start + migrations can take a while on a cold machine.
  testTimeout: 60_000,
  // Booting a controller transitively constructs BullMQ queues that hold open
  // ioredis connections (packages/redis) to the Redis testcontainer. Those
  // healthy idle sockets are open handles that keep Jest from exiting, so force
  // exit once tests finish. (global-setup gives them a REAL Redis so they don't
  // error-loop; forceExit just closes out the idle connections at the end.)
  forceExit: true,
  coverageDirectory: 'test-output/jest/coverage-integration',
};
