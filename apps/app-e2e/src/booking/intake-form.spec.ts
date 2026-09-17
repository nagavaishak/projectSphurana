import { expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * Patient intake-form fill-in E2E.
 *
 * Real API, real DB. The flow a patient runs from the link in the email a
 * clinic sends before their first appointment:
 *
 *     /forms/:orgSlug/:token   →   fill it in   →   completed
 *
 * Like manage-booking, this is an ANONYMOUS surface — the token is the whole
 * credential — so every test runs with `storageState: undefined`. The token is
 * unrecoverable from the DB (only its SHA-256 is stored), so we mint one through
 * the testing endpoint, exactly as the "send form" action does.
 */
test.describe('Intake form fill-in (patient self-serve)', () => {
  test.setTimeout(120_000);

  let orgSlug = '';
  let leadId = '';
  let formId = '';

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const seed = new SeedHelper(await context.newPage(), request);

    try {
      const org = (await seed.authenticatedApiCall(
        'GET',
        '/organization/active'
      )) as { slug?: string; id?: string };
      if (!org?.slug || !org?.id) {
        throw new Error(
          `[Intake] bare org has no slug/id: ${JSON.stringify(org)}`
        );
      }
      orgSlug = org.slug;

      const runId = Date.now();

      // A form with one required text field and one required consent box.
      const form = (await seed.authenticatedApiCall('POST', '/intake-forms', {
        name: `E2E Intake ${runId}`,
        fields: [
          {
            id: 'reason',
            type: 'short_text',
            label: 'Reason for visit',
            required: true,
          },
          {
            id: 'consent',
            type: 'checkbox',
            label: 'I consent to treatment',
            required: true,
          },
        ],
      })) as { id?: string };
      if (!form?.id) {
        throw new Error(
          `[Intake] failed to seed form: ${JSON.stringify(form)}`
        );
      }
      formId = form.id;

      // A client to attach the submission to.
      const lead = (await seed.authenticatedApiCall('POST', '/leads', {
        firstName: 'E2E Intake Patient',
        email: `e2e.intake.${runId}@example.com`,
      })) as { id?: string };
      if (!lead?.id) {
        throw new Error(
          `[Intake] failed to seed lead: ${JSON.stringify(lead)}`
        );
      }
      leadId = lead.id;
    } finally {
      await context.close();
    }
  });

  /** Mint a fresh fill-in link for the seeded form + lead. */
  async function issueLink(seed: SeedHelper) {
    const issued = (await seed.authenticatedApiCall(
      'POST',
      '/intake-forms/issue',
      {
        intakeFormId: formId,
        leadId,
      }
    )) as { token?: string };
    if (!issued?.token) {
      throw new Error(
        `[Intake] failed to issue link: ${JSON.stringify(issued)}`
      );
    }
    return issued.token;
  }

  test('an anonymous patient completes the form and it persists', async ({
    browser,
    request,
  }) => {
    const authed = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const seed = new SeedHelper(await authed.newPage(), request);
    const token = await issueLink(seed);
    await authed.close();

    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    try {
      await page.goto(`/forms/${orgSlug}/${token}`);

      await expect(page.getByText(/reason for visit/i)).toBeVisible({
        timeout: 15000,
      });

      await page.getByLabel(/reason for visit/i).fill('Consultation');
      await page.getByLabel(/i consent to treatment/i).check();
      await page.getByRole('button', { name: /submit|complete|send/i }).click();

      // Toast/thank-you = accepted. Reload = the real check.
      await expect(
        page.getByText(/thank you|completed|submitted/i)
      ).toBeVisible({
        timeout: 15000,
      });
      await page.reload();
      await expect(
        page.getByText(/already been completed|thank you|completed/i)
      ).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await context.close();
    }
  });

  test('the form blocks completion until the required consent is ticked', async ({
    browser,
    request,
  }) => {
    const authed = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const seed = new SeedHelper(await authed.newPage(), request);
    const token = await issueLink(seed);
    await authed.close();

    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    try {
      await page.goto(`/forms/${orgSlug}/${token}`);
      await expect(page.getByText(/reason for visit/i)).toBeVisible({
        timeout: 15000,
      });

      // Fill only the text field, leave the required consent unticked.
      await page.getByLabel(/reason for visit/i).fill('Consultation');
      await page.getByRole('button', { name: /submit|complete|send/i }).click();

      // Still on the form — a required-field error, not a thank-you.
      await expect(page.getByText(/required/i).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByText(/thank you|completed|submitted/i)
      ).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('a well-formed but never-issued token shows the dead-link screen', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    try {
      await page.goto(`/forms/${orgSlug}/${'A'.repeat(43)}`);
      await expect(page.getByText(/no longer valid|not found/i)).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await context.close();
    }
  });
});
