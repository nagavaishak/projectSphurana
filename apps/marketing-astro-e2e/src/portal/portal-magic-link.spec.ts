import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  portalPath,
  requireSeed,
} from '../fixtures/index.js';

/**
 * Staff "Copy portal link" → the customer opens it → they are in (ENG-647).
 *
 * Real API, real DB, no mocking. This covers the one flow the unit and
 * integration layers structurally cannot: a credential minted by one party,
 * opened later by another, in a browser.
 *
 * MOVED FROM apps/app-e2e/src/portal/. The landing route is now
 * `/sites/{slug}/portal/access?token=…` on the marketing host, and the session
 * it establishes is a first-party cookie — there is no token in localStorage to
 * seed or assert any more.
 *
 * WHAT IT OPENS. The spec asserts the minted URL's PATH is the microsite one
 * (`/sites/{slug}/portal/access`) and then opens that path relative to
 * BASE_URL. The origin is deliberately not followed: it comes from the API's
 * `WEB_URL`, which on a PR preview is a different deployment from the marketing
 * preview under test, so `goto(mintedUrl)` would navigate away from it. A
 * builder that regresses to the old `/portal/{slug}/…` shape still fails here.
 *
 * TWO THINGS IT STILL PINS
 *
 * 1. Single use. The token is consumed on redemption, so a second open must
 *    say so.
 * 2. It must not HANG. The dead-link path was a real bug: the verify mutation
 *    fires from a ref-guarded mount effect, and under React StrictMode's
 *    simulated remount the observer is dropped, so `mutation.error` never
 *    re-rendered and a spent link sat on "Signing you in…" forever. The fix
 *    holds failure in local state; without a test, the next refactor of that
 *    effect silently reintroduces it.
 */
test.describe('marketing-astro · portal magic link', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let leadId = '';
  let leadFirstName = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Unique per WORKER, not just per millisecond: `fullyParallel` runs a
    // file's tests across workers, so `beforeAll` executes once per worker and
    // two can mint the same lead email in the same millisecond — 409.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    leadFirstName = `E2E MagicLink ${runId}`;
    const lead = await seed.createLead({
      firstName: leadFirstName,
      email: `e2e.magiclink.${runId}@example.com`,
    });
    leadId = lead.id;
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('opens once, then reports the link is spent instead of hanging', async ({
    page,
  }) => {
    // Mint as STAFF — this is the "Copy portal link" button's endpoint.
    const { mintedUrl, accessPath } =
      await requireSeed(seed).mintMagicLink(leadId);

    // Asserted, not branched on. This is the half of the flow that lives in
    // the API: staff must be handed a link to the MICROSITE portal, not to the
    // route apps/app used to serve.
    expect(
      new URL(mintedUrl).pathname,
      `staff mint should target the microsite portal (got ${mintedUrl})`
    ).toBe(portalPath(orgSlug, '/access'));

    await test.step('first open signs them in', async () => {
      await page.goto(accessPath, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(`**${portalPath(orgSlug)}`, { timeout: 30_000 });

      // Reload and re-read: the greeting comes from `GET /api/patient/me`, so
      // it proves a real cookie session survived a fresh document load rather
      // than a client-side redirect.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        page.getByRole('heading', {
          name: new RegExp(`Hi ${leadFirstName}`, 'i'),
        })
      ).toBeVisible({ timeout: 20_000 });
    });

    await test.step('second open is refused, and says so', async () => {
      await page.goto(accessPath, { waitUntil: 'domcontentloaded' });

      // The assertion that matters: a VISIBLE outcome. The bug was an
      // indefinite spinner, so "not hanging" is the property under test.
      await expect(
        page.getByRole('heading', { name: /link expired/i })
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole('link', { name: /sign in with email/i })
      ).toBeVisible();
    });
  });

  test('a bogus token reports expiry rather than spinning', async ({
    page,
  }) => {
    await page.goto(portalPath(orgSlug, '/access?token=not-a-real-token'), {
      waitUntil: 'domcontentloaded',
    });

    await expect(
      page.getByRole('heading', { name: /link expired/i })
    ).toBeVisible({ timeout: 20_000 });
  });
});
