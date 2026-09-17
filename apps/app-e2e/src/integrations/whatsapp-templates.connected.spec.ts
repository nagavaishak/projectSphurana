import { expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * WhatsApp Templates — Connected Org (apps/app port)
 *
 * The connected org has a WhatsApp account seeded by setup-connected
 * (system-user token via POST /testing/seed-whatsapp), so this spec reads
 * that state rather than seeding/tearing down per-test.
 *
 * Tests split:
 *   - **Always-run tests** verify UI wiring: card shows as connected,
 *     settings dialog opens, templates section renders.
 *   - **Real-creds tests** (gated on TEST_WHATSAPP_REAL_CREDS=1) exercise
 *     real Meta template creation against the live WABA. NOTE: apps/app's
 *     WhatsApp settings dialog does not expose a per-template delete
 *     control today (the web app's delete UI hasn't been ported yet), so
 *     the CRUD test only covers create + read-back. Cleanup of created
 *     templates is intentionally out of scope until the delete UI lands.
 *
 * Auth: connected-user — applied automatically by the `connected` project
 *   via storageState from `setup-connected`.
 */

const hasRealCreds = process.env.TEST_WHATSAPP_REAL_CREDS === '1';

/**
 * The account is seeded by `setup-connected` from the TEST_WHATSAPP_* env vars,
 * so those vars — not anything observed in the app — are the precondition. Gate
 * on them at describe level; when they ARE set the seeded account must exist and
 * that is asserted, not skipped.
 */
const HAS_WHATSAPP_CREDS = Boolean(
  process.env.TEST_WHATSAPP_ACCESS_TOKEN &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER_ID &&
    process.env.TEST_WHATSAPP_WABA_ID &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER
);

test.describe('WhatsApp Templates — Connected Org', () => {
  test.setTimeout(120_000);

  test.skip(
    !HAS_WHATSAPP_CREDS,
    'WhatsApp creds not configured (set TEST_WHATSAPP_ACCESS_TOKEN / _PHONE_NUMBER_ID / _WABA_ID / _PHONE_NUMBER)'
  );

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({
      storageState: '.auth/connected-user.json',
    });
    const page = await context.newPage();
    const seed = new SeedHelper(page, request);
    const hasAccount = await seed.hasConnectedWhatsAppAccount();
    await context.close();
    expect(
      hasAccount,
      'connected org should have a seeded WhatsApp account'
    ).toBe(true);
  });

  test('WhatsApp card is connected and settings dialog opens with templates section', async ({
    page,
  }) => {
    await page.goto('/dashboard/settings/integrations');
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30_000 });

    await test.step('WhatsApp card shows as connected', async () => {
      const whatsappCard = page
        .locator('[class*="card"], [data-testid*="integration"]')
        .filter({ hasText: /whatsapp/i })
        .first();
      await expect(whatsappCard).toBeVisible({ timeout: 10_000 });

      await expect(
        whatsappCard.getByRole('button', { name: /edit connection/i })
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step('settings dialog opens with templates section', async () => {
      const whatsappCard = page
        .locator('[class*="card"], [data-testid*="integration"]')
        .filter({ hasText: /whatsapp/i })
        .first();
      await whatsappCard
        .getByRole('button', { name: /edit connection/i })
        .click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(dialog).toContainText(/whatsapp/i);

      // apps/app's dialog exposes a single "New Template" CTA (no
      // "Add template" / "Create template" variants).
      const templateCta = dialog.getByRole('button', {
        name: /new template/i,
      });
      await expect(templateCta.first()).toBeVisible({ timeout: 10_000 });
    });
  });

  test('reconnect banner is NOT visible when token is valid', async ({
    page,
  }) => {
    await page.goto('/dashboard/settings/integrations');
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30_000 });

    // Wait on the real condition (the connected WhatsApp card rendered) rather
    // than a blind 500ms sleep — otherwise the negative assertion below would
    // pass against a page that simply hadn't rendered yet.
    const whatsappCard = page
      .locator('[class*="card"], [data-testid*="integration"]')
      .filter({ hasText: /whatsapp/i })
      .first();
    await expect(whatsappCard).toBeVisible({ timeout: 30_000 });
    await expect(
      whatsappCard.getByRole('button', { name: /edit connection/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(
        /whatsapp connection expired|whatsapp connection expires in/i
      )
    ).toBeHidden();
  });

  test.describe('template create (real Meta creds required)', () => {
    test.skip(
      !hasRealCreds,
      'Set TEST_WHATSAPP_REAL_CREDS=1 to run template creation against real Meta'
    );

    const templateName = `e2e_template_${Date.now()}`;

    test('create a template (delete UI not yet ported to apps/app)', async ({
      page,
    }) => {
      await page.goto('/dashboard/settings/integrations');
      await page
        .locator('[data-sidebar="menu-button"]')
        .last()
        .waitFor({ timeout: 30_000 });

      const whatsappCard = page
        .locator('[class*="card"], [data-testid*="integration"]')
        .filter({ hasText: /whatsapp/i })
        .first();
      await whatsappCard
        .getByRole('button', { name: /edit connection/i })
        .click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await test.step('open create form + fill', async () => {
        await dialog
          .getByRole('button', { name: /new template/i })
          .first()
          .click();

        // The create form's fields are shadcn <Field> + <FieldLabel> without an
        // htmlFor link, so anchor on the placeholders (whatsapp-settings-dialog.tsx).
        // Category defaults to UTILITY — no interaction needed, and the old
        // "click it only if it happens to be visible" branch was a coin flip.
        await dialog
          .getByPlaceholder(/appointment_reminder/i)
          .fill(templateName);

        await dialog
          .getByPlaceholder(/your appointment is confirmed/i)
          .fill('E2E test template body.');

        await dialog
          .getByRole('button', { name: /create template/i })
          .last()
          .click();
      });

      await test.step('new template appears in list', async () => {
        await expect(dialog.getByText(templateName)).toBeVisible({
          timeout: 30_000,
        });
      });

      // NOTE: apps/app's WhatsApp settings dialog does not yet expose a
      // per-template delete control. The web app's delete flow tested
      // here in the web-e2e port is intentionally omitted until the
      // delete UI is ported. Orphaned `e2e_template_*` entries on the
      // live WABA will need manual cleanup or a future API-driven
      // teardown until then.
    });
  });
});
