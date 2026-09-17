import { writeFileSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { SeedHelper, TEST_DATA, branchUrl } from './fixtures/index.js';
import { stampAuthFile } from './fixtures/stack-identity.fixture.js';

const AUTH_FILE = '.auth/bare-user.json';
/** The org `AUTH_FILE`'s session was prepared for — see the write below. */
const ORG_FILE = '.auth/bare-org.json';

/**
 * Auth setup for the bare org (no Meta integration).
 * Used by the `authenticated` project.
 *
 * Signs in through the real UI — no testing endpoints needed.
 * The test account must already exist on the API.
 *
 * apps/app uses cookie-session auth on the web (see
 * `apps/app/src/lib/api-client.ts` — `authProvider` is only set in native
 * Capacitor). Playwright's `storageState` captures cookies by domain, so
 * a one-time UI sign-in here rehydrates every dependent test.
 */
setup('authenticate bare user', async ({ page, request }) => {
  setup.setTimeout(120_000);
  // Vite dev cold-compiles each route on first hit; bump goto timeout so
  // the initial /sign-in navigation doesn't flake at 30s.
  page.setDefaultNavigationTimeout(60_000);

  const seed = new SeedHelper(page, request);
  const email = TEST_DATA.bareUser.email;
  const password = TEST_DATA.bareUser.password;

  // Ensure the shared bare fixture EXISTS before signing in. The bare org is now
  // reproducible-from-code (provision-org is idempotent + concurrency-safe), so a
  // freshly-reset preview DB self-heals on the first run instead of failing with
  // a "broken fixture" — no more hand-built rows that must live forever in
  // preview-shared.
  const orgId = await seed.ensureProvisionedOrg({
    email,
    password,
    name: 'E2E Bare Owner',
    orgName: 'E2E Bare Salon',
    businessType: 'salon',
  });
  console.log(`[Setup Bare] Ensured bare org ${orgId} exists`);

  await seed.signInUser(email, password);
  console.log('[Setup Bare] Signed in via UI');

  // Point THIS session at the org before any org-scoped seeding.
  //
  // A session minted by sign-in carries no `activeOrganizationId`; the app
  // patches it from the `_authed` guard, but the cookie-authed calls below do
  // not wait for that. When they win the race every one of them 400s with "No
  // active organization selected", setup-bare fails, and every spec in the
  // lane then dies on a missing `.auth/bare-user.json` — an error that names
  // storage state and says nothing about the org.
  //
  // org.fixture.ts already does this for per-test orgs and documents why; the
  // shared bare org needs it for the same reason.
  await seed.authenticatedApiCall('POST', '/organization/active', {
    organizationId: orgId,
  });

  // SEED the subscription rather than assume it.
  //
  // The bare org is long-lived shared data, so its subscription is whatever the
  // DB happens to hold — and a trial EXPIRES with the passage of time alone.
  // src/billing.spec.ts asserts "/billing redirects the SUBSCRIBED bare user to
  // the dashboard"; once the trial lapsed that precondition silently vanished and
  // the spec failed for a reason that had nothing to do with the redirect under
  // test. Forcing an active subscription here makes the fixture deterministic
  // (the endpoint upserts, so this is idempotent).
  //
  // orgId is already resolved above from ensureProvisionedOrg. provision-org also
  // asserts a subscription, but re-asserting here keeps the guarantee explicit
  // (idempotent upsert).
  await seed.forceCreateSubscription(orgId);
  console.log(`[Setup Bare] Ensured active subscription for org ${orgId}`);

  // PRICED services, too. /billing no longer bounces on unpriced services
  // (that gate and /setup-services are gone), but specs that assert on prices
  // still need the bare org's services priced, and seeding it here keeps the
  // shared org consistent across suites.
  await seed.ensureServicesPriced();
  console.log('[Setup Bare] Ensured every service carries a price');

  // A BRANCH, because since #927 a location is the unit of work and every
  // branch-scoped surface is addressed as `/dashboard/l/:branch/…`.
  //
  // The bare org is long-lived shared data and nothing here ever created one,
  // so `GET /organization-locations` answered `200 []`. `branchUrl()` then had
  // no handle, handed back the un-prefixed path, and the app's compatibility
  // splat redirected to `/dashboard/locations` — so mobile specs died on a
  // `toHaveURL` naming the location picker, several steps from the cause. It
  // read as flake because WHICH specs got there varied with sharding.
  //
  // Idempotent: it only creates when the org has none, so a re-run (and the
  // connected org, which has its own) is untouched.
  await seed.ensureBranchExists();
  console.log('[Setup Bare] Ensured the org has at least one branch');

  // Record WHICH org this storage state was prepared for.
  //
  // Active organization is SERVER-side session state, and the bare session is
  // shared by every spec in the lane. Any spec that re-points it (several call
  // `POST /organization/active` to work on an org of their own) silently
  // re-points it for all the others, and `GET /organization-locations` then
  // answers for that org instead — `200 []` if it has no branch. That is what
  // made the lane fail on a different spec each run.
  //
  // `branch.fixture.ts` uses this to detect the drift and put the session back,
  // rather than every spec having to remember not to disturb its neighbours.
  writeFileSync(ORG_FILE, JSON.stringify({ organizationId: orgId }, null, 2));
  console.log(`[Setup Bare] Recorded bare org ${orgId} for branch resolution`);

  // Handle post-login redirects (onboarding, billing).
  await page.waitForTimeout(2000);

  if (page.url().includes('onboarding')) {
    console.log('[Setup Bare] Completing onboarding...');
    await seed.completeOnboarding({
      name: 'E2E Bare Salon',
      businessType: 'salon',
    });
    await page.waitForTimeout(2000);
  }

  // If stuck on billing, try navigating to the home dashboard — pre-seeded
  // accounts already have a subscription.
  for (let i = 0; i < 3; i++) {
    const currentUrl = page.url();
    if (currentUrl.includes('billing')) {
      console.log(`[Setup Bare] On ${currentUrl}, navigating to dashboard...`);
      await page.goto(await branchUrl(page, '/dashboard/home'));
      await page.waitForTimeout(2000);
    } else {
      break;
    }
  }

  // Verify we landed on a protected page — wait for the sidebar to mount.
  await page
    .locator('[data-sidebar="menu-button"]')
    .last()
    .waitFor({ timeout: 30_000 });

  const state = await page.context().storageState({ path: AUTH_FILE });
  const sessionCookies = state.cookies.filter(
    (c) => c.name.includes('session') || c.name.includes('better-auth')
  );
  if (sessionCookies.length === 0) {
    throw new Error(
      '[Setup Bare] No session cookies found after sign-in — auth setup likely failed.'
    );
  }
  console.log(
    `[Setup Bare] Saved storageState (${state.cookies.length} cookies, ${sessionCookies.length} session-related)`
  );

  // Record WHICH stack minted this session. A cookie is only valid against the
  // database that holds its session row, so a later run on a different stack
  // must re-mint rather than hand 40 specs a token that 401s — see
  // fixtures/stack-identity.fixture.ts.
  await stampAuthFile(AUTH_FILE);
});
