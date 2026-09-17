/* eslint-disable */
/**
 * Jest config for REAL-AUTH integration tests (`*.auth-int-spec.ts`).
 *
 * Same Postgres + Redis testcontainers and the same per-worker env as
 * jest.integration.config.ts, with ONE deliberate difference: it does NOT stub
 * `@borradh-workspace/auth/server`.
 *
 * That stub exists in the sibling config for a good reason — better-auth is
 * ESM-only and drags in the whole session/Redis wiring, and the ~70
 * `*.int-spec.ts` files override AuthGuard anyway, so the real `auth` object is
 * dead weight there and breaks most suites at load.
 *
 * The cost is that nothing in that suite can test how an identity is RESOLVED,
 * which is exactly where impersonation broke. This config buys that back for
 * the few specs that need it, without touching the other seventy.
 *
 * Kept SELF-CONTAINED rather than importing the sibling: jest parses config
 * files as ESM and will not resolve a relative TS import between two of them.
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);
swcJestConfig.swcrc = false;
swcJestConfig.module = { ...(swcJestConfig.module ?? {}), type: 'commonjs' };

export default {
  displayName: '@borradh-workspace/api:auth-integration',
  testEnvironment: 'node',
  transform: {
    // `.mjs`/`.cjs` matter here and nowhere else: the better-auth family ships
    // both extensions, and the stock `[tj]s` pattern matches neither — those
    // modules reach the CJS runtime untransformed and throw "Cannot use import
    // statement outside a module".
    '^.+\\.[mc]?[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleNameMapper: {
    // '@borradh-workspace/auth/server' is deliberately NOT stubbed here.
    // The patient-portal instance still is: it is only reached transitively
    // and nothing in this suite exercises it.
    '^@borradh-workspace/auth/patient$':
      '<rootDir>/src/_integration/__mocks__/auth-patient.ts',
    // Sign-up sends a verification email and RE-THROWS on failure, so a real
    // send would fail the sign-up itself. See the stub for why it cannot run
    // under Jest.
    '^@borradh-workspace/email$':
      '<rootDir>/src/_integration/__mocks__/email.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The sibling config's allowlist PLUS the better-auth ESM family, derived by
  // walking every bare import in better-auth's dist rather than discovering
  // them one runtime failure at a time. Scoped packages land in .pnpm as
  // `@scope+name@version`, so each alternative has to consume the package name
  // — the lookahead requires an `@` immediately after it.
  //
  // Transforming ALL of node_modules is not an option: SWC mangles already-CJS
  // packages that use private fields (minimatch is the first to blow up).
  transformIgnorePatterns: [
    `node_modules/\\.pnpm/(?!(${[
      '@paralleldrive\\+cuid2',
      '@noble\\+[a-z-]+',
      '@t3-oss\\+env-core',
      'nanoid',
      'better-auth',
      'better-call',
      '@better-auth\\+[a-z-]+',
      '@better-fetch\\+[a-z-]+',
      'defu',
      'jose',
      'uncrypto',
      'rou3',
      'zod',
    ].join('|')})@)`,
  ],
  testMatch: ['**/*.auth-int-spec.ts'],
  // Order matters: the shared env first, then this suite's overrides.
  setupFiles: [
    '<rootDir>/src/_integration/setup-after-env.ts',
    '<rootDir>/src/_integration/setup-auth-env.ts',
  ],
  setupFilesAfterEnv: [
    '<rootDir>/src/_integration/mock-observability.ts',
    '<rootDir>/src/_integration/close-connections.ts',
  ],
  globalSetup: '<rootDir>/src/_integration/global-setup.ts',
  globalTeardown: '<rootDir>/src/_integration/global-teardown.ts',
  maxWorkers: 1,
  testTimeout: 60_000,
  forceExit: true,
  coverageDirectory: 'test-output/jest/coverage-auth-integration',
};
