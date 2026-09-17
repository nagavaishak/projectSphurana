/* eslint-disable */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

export default {
  displayName: '@borradh-workspace/api',
  testEnvironment: 'node',
  // Set SKIP_ENV_VALIDATION before any module (and thus any env createEnv call)
  // is evaluated, so env modules with required vars don't throw at import.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  // `@t3-oss/env-core` ships ESM-only and is now reached through the
  // integrations barrel (env/loops → @t3-oss/env-core) since the Loops
  // integration was added. Jest's default ignores all of node_modules, so that
  // bare ESM `import` fails to load ("Cannot use import statement outside a
  // module"). Transform just this one pnpm dep; everything else stays ignored.
  transformIgnorePatterns: ['/node_modules/\\.pnpm/(?!(@t3-oss\\+env-core)@)'],
  moduleNameMapper: {
    // The patient-portal better-auth instance is ESM-only and cannot be
    // require()d from this CJS suite. It is now reachable transitively from
    // features/organization-locations (deleteLocation → appointments barrel →
    // consent-forms → patient-auth), which loads it for specs that have no
    // interest in it whatsoever — tool-registry.spec.ts died on it. Same stub
    // and same reasoning as jest.integration.config.ts, which has mapped it
    // since the second auth instance landed.
    '^@borradh-workspace/auth/patient$':
      '<rootDir>/src/_integration/__mocks__/auth-patient.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Only run TypeScript source specs. `nest build` compiles specs into dist/,
  // and jest's default testMatch would otherwise also pick up those compiled
  // dist/*.spec.js duplicates — which fail module resolution (their require()
  // of './x.js' + the .js→bare moduleNameMapper don't resolve against dist).
  roots: ['<rootDir>/src'],
  // Integration tests (*.int-spec.ts) are run by jest.integration.config.ts
  // against a real testcontainers Postgres. Exclude them here so the unit
  // suite (which mocks the db) never tries to boot a real DB. /dist/ is also
  // excluded as a belt-and-braces guard against compiled spec duplicates.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.int-spec\\.ts$'],
  coverageDirectory: 'test-output/jest/coverage',
};
