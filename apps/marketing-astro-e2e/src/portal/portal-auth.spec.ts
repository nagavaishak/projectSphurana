import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  fillHydrated,
  portalPath,
  requireSeed,
} from '../fixtures/index.js';

/**
 * Customer portal passwordless sign-in E2E (ENG-647), on its new home.
 *
 * Real API, real DB, no mocking. Exercises the flow a returning customer runs:
 *
 *   /sites/{slug}/portal/sign-in → enter email → enter emailed 6-digit code → in
 *
 * MOVED FROM apps/app-e2e/src/portal/. Three things changed with the port:
 *
 *  1. URLS. The portal was `app.borradh.io/portal/{slug}/…`; it is now served
 *     by marketing-astro at `/sites/{slug}/portal/…` (the PATH tier — the only
 *     microsite tier that resolves today).
 *  2. AUTH IS COOKIE-ONLY. The bearer token in `localStorage` is gone, so
 *     nothing here seeds, reads or asserts a token. The session arrives as an
 *     httpOnly cookie on the verify response, made first-party by the Astro
 *     `/api/*` proxy.
 *  3. `X-Portal-Org` now comes from a prop the Astro page resolved, not from a
 *     regex over the pathname — which is why the sign-in still works on a path
 *     like `/sites/{slug}/portal/bookings`.
 *
 * The portal is PUBLIC: an anonymous visitor with no account signs in purely by
 * proving they own an email the clinic already has on file. This suite carries
 * no storageState, so `page` is already that anonymous visitor. Only the SEED
 * (the lead the clinic "has on file") is staff-authenticated, over HTTP.
 *
 * WHY WE MINT THE OTP VIA /testing INSTEAD OF READING THE EMAIL
 * The code is stored hashed, so the raw value is unrecoverable from the DB.
 * `seed.patientOtp()` asks the API to mint a fresh usable one — exactly what
 * the sign-in email carries. We stand in for the mail client, we do not bypass
 * the feature.
 */

const OTP_GROUP = '6-digit code';

test.describe('marketing-astro · portal sign-in', () => {
  // ENVIRONMENT gate, declared up front. Everything below either seeds its
  // precondition or fails.
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let leadEmail = '';
  let leadFirstName = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Unique per WORKER, not just per millisecond: `fullyParallel` runs a
    // file's tests across workers, so `beforeAll` executes once per worker and
    // two can mint the same lead email in the same millisecond — 409.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    leadFirstName = `E2E Portal ${runId}`;
    leadEmail = `e2e.portal.${runId}@example.com`;
    await seed.createLead({ firstName: leadFirstName, email: leadEmail });
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('signs in with an emailed OTP and lands in the portal', async ({
    page,
  }) => {
    await page.goto(portalPath(orgSlug, '/sign-in'), {
      waitUntil: 'domcontentloaded',
    });

    await fillHydrated(page.getByLabel('Email'), leadEmail, expect);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2 (code) is now shown. Mint the code the email would carry.
    const group = page.getByRole('group', { name: OTP_GROUP });
    // Wait for the code step BEFORE minting. Continue triggers the app's
    // own OTP request; minting while that is still in flight means the
    // app's code lands second and invalidates ours, and the form then
    // reports "that code didn't work" for a code that was valid when
    // it was issued.
    await expect(group).toBeVisible({ timeout: 15_000 });
    const otp = await requireSeed(seed).patientOtp(leadEmail);
    await group.locator('input').first().focus();
    await page.keyboard.type(otp); // auto-advances + auto-submits on the 6th

    // Signed in → routed to the portal home on the microsite path tier.
    await page.waitForURL(`**${portalPath(orgSlug)}`, { timeout: 20_000 });

    // Reload and re-read: the greeting is rendered from `GET /api/patient/me`,
    // so it can only appear if the COOKIE survived a fresh document load. A
    // client-side redirect alone would not produce it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', {
        name: new RegExp(`Hi ${leadFirstName}`, 'i'),
      })
    ).toBeVisible({ timeout: 20_000 });
  });

  test('rejects a wrong code, accepts the right one', async ({ page }) => {
    await page.goto(portalPath(orgSlug, '/sign-in'), {
      waitUntil: 'domcontentloaded',
    });
    await fillHydrated(page.getByLabel('Email'), leadEmail, expect);
    await page.getByRole('button', { name: 'Continue' }).click();

    const group = page.getByRole('group', { name: OTP_GROUP });
    await expect(group).toBeVisible({ timeout: 15_000 });

    // Wrong code → a visible error, and we stay on the sign-in route.
    await group.locator('input').first().focus();
    await page.keyboard.type('000000');
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(
      new RegExp(`${portalPath(orgSlug, '/sign-in')}`)
    );

    // The right code then works (boxes were cleared on the failed attempt).
    const otp = await requireSeed(seed).patientOtp(leadEmail);
    await group.locator('input').first().focus();
    await page.keyboard.type(otp);
    await page.waitForURL(`**${portalPath(orgSlug)}`, { timeout: 20_000 });
  });
});
