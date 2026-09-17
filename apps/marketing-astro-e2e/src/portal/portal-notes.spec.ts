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
 * Staff-internal notes must never reach the customer's portal (ENG-647).
 *
 * `lead.notes` is commentary written on the assumption that no customer would
 * ever read it. `lead.portalNote` is the note addressed TO them. They are two
 * columns rather than one column plus a visibility flag precisely so a single
 * forgotten filter cannot publish years of internal commentary retroactively,
 * to the people it describes.
 *
 * The unit layer pins the payload mapper and migration 0135 pins the DB grant
 * (`app_patient` cannot even SELECT `lead.notes`). This closes the last gap
 * between them: what a real browser, with a real session, actually receives.
 *
 * MOVED FROM apps/app-e2e/src/portal/. The page is now
 * `/sites/{slug}/portal`, and the payload call it makes is `/api/patient/me`
 * on the MARKETING origin — the Astro proxy forwards it to the API with the
 * first-party session cookie. `X-Portal-Org` is set from the org prop the page
 * resolved server-side, so nothing here has to arrange it.
 */
test.describe('marketing-astro · portal notes boundary', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  /** Deliberately distinctive: greppable in any payload or rendered page. */
  const INTERNAL_SENTINEL = 'INTERNAL-DO-NOT-SHOW-XYZZY';
  const PORTAL_NOTE = 'Please arrive ten minutes early.';

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let leadEmail = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Unique per WORKER, not just per millisecond: `fullyParallel` runs a
    // file's tests across workers, so `beforeAll` executes once per worker and
    // two can mint the same lead email in the same millisecond — 409.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    leadEmail = `e2e.notes.${runId}@example.com`;
    // Staff commentary, and the customer-facing note, on the same record.
    const lead = await seed.createLead({
      firstName: `E2E Notes ${runId}`,
      email: leadEmail,
      notes: INTERNAL_SENTINEL,
    });
    await seed.setPortalNote(lead.id, PORTAL_NOTE);
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('shows the clinic note and nothing of the internal one', async ({
    page,
  }) => {
    await test.step('sign in as the customer', async () => {
      await page.goto(portalPath(orgSlug, '/sign-in'), {
        waitUntil: 'domcontentloaded',
      });
      await fillHydrated(page.getByLabel('Email'), leadEmail, expect);
      await page.getByRole('button', { name: 'Continue' }).click();

      const group = page.getByRole('group', { name: '6-digit code' });
      // Wait for the code step BEFORE minting. Continue triggers the app's
      // own OTP request; minting while that is still in flight means the
      // app's code lands second and invalidates ours, and the form then
      // reports "that code didn't work" for a code that was valid when
      // it was issued.
      await expect(group).toBeVisible({ timeout: 15_000 });
      const otp = await requireSeed(seed).patientOtp(leadEmail);
      await group.locator('input').first().focus();
      await page.keyboard.type(otp);
      await page.waitForURL(`**${portalPath(orgSlug)}`, { timeout: 20_000 });
    });

    await test.step('the note addressed to them is shown', async () => {
      await expect(page.getByText(PORTAL_NOTE)).toBeVisible({
        timeout: 20_000,
      });
    });

    await test.step('the internal note appears nowhere on the page', async () => {
      // Whole rendered document, not a specific element: the point is that the
      // string is absent from anything the customer can reach.
      const body = await page.locator('body').innerText();
      expect(body).not.toContain(INTERNAL_SENTINEL);
    });

    await test.step('and nowhere in the API payload either', async () => {
      // The rendered page could hide a field the payload still carries — one
      // `JSON.stringify` in a future debug panel and it is on screen.
      //
      // Observe the request the PORTAL ITSELF makes rather than issuing one
      // from the page. On the microsite the portal calls `/api/patient/me`
      // SAME-ORIGIN and the Astro proxy adds nothing we could reproduce by
      // hand: the httpOnly session cookie rides along because it is
      // first-party, and `X-Portal-Org` comes from the page's resolved org
      // prop. Waiting on the app's own request gets all of that right for
      // free, and asserts on the exact bytes the portal received — the
      // stronger claim anyway.
      const responsePromise = page.waitForResponse(
        (res) => new URL(res.url()).pathname.endsWith('/patient/me'),
        { timeout: 20_000 }
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      const raw = await (await responsePromise).text();

      // Unconditional. A test that only checks the payload when it happens to
      // arrive can pass by not looking — which is the failure mode the whole
      // notes design exists to prevent.
      expect(raw).not.toContain(INTERNAL_SENTINEL);
      // No `notes` KEY at all — not merely an empty value. An absent key
      // cannot be accidentally populated by a later mapper change.
      expect(JSON.parse(raw)).not.toHaveProperty('notes');
    });
  });
});
