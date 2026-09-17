import { type Page, test as base } from '@playwright/test';
import { SeedHelper } from './seed.fixture.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export interface FreshOrg {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  /** A browser page already signed in as this org's owner. */
  page: Page;
  /** SeedHelper bound to `page` — UI helpers + cookie-authed API seeding. */
  seed: SeedHelper;
}

/**
 * Per-test-org fixture — the backbone of the tab-organized E2E suites.
 *
 * Every test gets its OWN freshly-provisioned, verified, empty organization
 * (entirely via the testing API) and a browser page signed in as that org's
 * owner. That is what makes these suites order-independent and `fullyParallel`
 * — no shared bare org, no cross-test state, each spec individually runnable.
 * The owner is an `e2e.test.*` user, so `global-teardown`'s cleanup reaps it.
 *
 * Seed prerequisites through the REAL authenticated API from inside a test via
 * `org.seed.authenticatedApiCall(...)` (the org's session cookie is on `page`),
 * so a spec drives only the surface under test.
 */
export const test = base.extend<{ org: FreshOrg }>({
  org: async ({ browser, contextOptions }, use, testInfo) => {
    // Forward the project's contextOptions (viewport, device, isMobile,
    // hasTouch, userAgent from a `devices[...]` descriptor) so the manually-
    // built context honors the project — otherwise a mobile-viewport project
    // (Pixel 7) would silently render at the default desktop viewport.
    const context = await browser.newContext({
      ...contextOptions,
      baseURL: BASE_URL,
    });
    const page = await context.newPage();
    // createEmptyVerifiedOrg does API sign-up + email-verify (navigates `page`)
    // + create-org + force-verify; the API calls ride `page.request`.
    const seed = new SeedHelper(page, page.request);

    const org = await seed.createEmptyVerifiedOrg(testInfo.title);
    // Establish a clean owner session on this context via the real sign-in form.
    await seed.signInUser(org.email, org.password);
    // A brand-new API-created org isn't auto-set as the session's active org, so
    // org-scoped endpoints 400 with "No active organization selected". Set it
    // explicitly on this session (the browser + cookie-authed seeding share it).
    await seed.authenticatedApiCall('POST', '/organization/active', {
      organizationId: org.orgId,
    });
    // Most product surfaces are gated behind a subscription ("A paid plan is
    // required"). Grant one (bypasses Stripe) so broad-shallow specs exercise
    // the real surface, not the paywall. Specs that WANT the unpaid state can
    // provision their own org without this — but that's the rare case.
    await seed.forceCreateSubscription(org.orgId);

    await use({ ...org, page, seed });

    await context.close();
  },
});

export { expect } from '@playwright/test';
