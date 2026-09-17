import fs from 'node:fs';
import dotenv from 'dotenv';
import {
  assertAppServerIsOurs,
  assertStackIdentity,
  invalidateStaleAuthState,
} from './fixtures/stack-identity.fixture.js';

const envFile =
  process.env.E2E_ENV === 'staging' ? '.env.staging' : '.env.test';
dotenv.config({ path: envFile });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Global setup: PREFLIGHT, then write a minimal base storageState so every
 * project has a known starting context.
 *
 * The preflight asserts that the api answering at API_URL is the one this
 * worktree started — see fixtures/stack-identity.fixture.ts for why a 200 from
 * /health is not that assurance. It is a no-op on staging / preview / CI, which
 * carry no EXPECT_DB_NAME stamp.
 *
 * apps/app doesn't render a cookie consent banner (apps/web does), so unlike
 * apps/web-e2e we don't seed a `borradh-cookie-consent` cookie. We do still
 * pre-set the dashboard's "onboarding checklist dismissed" localStorage flag
 * to keep the home page clear of the welcome card on freshly-signed-in runs.
 */
export default async function globalSetup() {
  const identity = await assertStackIdentity();
  await assertAppServerIsOurs();
  if (identity) {
    console.log(
      `[preflight] api ${process.env.API_URL} → db ${identity.database}, sha ${identity.sha} (${identity.cwd})`
    );
    invalidateStaleAuthState(identity, [
      '.auth/bare-user.json',
      '.auth/connected-user.json',
    ]);
  }

  const storageState = {
    cookies: [] as never[],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [
          { name: 'onboarding-checklist-dismissed', value: 'true' },
        ],
      },
    ] as { origin: string; localStorage: { name: string; value: string }[] }[],
  };

  fs.mkdirSync('.auth', { recursive: true });
  fs.writeFileSync('.auth/base.json', JSON.stringify(storageState, null, 2));
}
