import { expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * WhatsApp Reconnect Banner — Connected Org (apps/app port)
 *
 * The connected org has a valid WhatsApp account seeded by setup-connected
 * (system-user token via POST /testing/seed-whatsapp), so this spec asserts
 * the "no banner when healthy" case. The destructive and pre-expiry variants
 * require mutating token state on the DB, which the destructive testing
 * endpoints don't allow on staging — those are covered by feature-service
 * unit tests instead.
 *
 * Auth: connected-user — applied automatically by the `connected` project
 *   via storageState from `setup-connected`.
 */
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

test.describe('WhatsApp Reconnect Banner — Connected Org', () => {
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

  test('valid token shows no reconnect banner', async ({ page }) => {
    await page.goto('/dashboard/settings/integrations');
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30_000 });

    // Wait on the real condition the blind 500ms sleep was standing in for:
    // the WhatsApp integration card must have rendered its connected state.
    // Only then is the absence of a reconnect banner meaningful (on an empty
    // page every `not.toBeVisible()` trivially passes).
    const whatsappCard = page
      .locator('[class*="card"], [data-testid*="integration"]')
      .filter({ hasText: /whatsapp/i })
      .first();
    await expect(whatsappCard).toBeVisible({ timeout: 30_000 });
    await expect(
      whatsappCard.getByRole('button', { name: /edit connection/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole('button', { name: /reconnect whatsapp/i })
    ).toBeHidden();
    await expect(
      page.getByText(/whatsapp connection expires in/i)
    ).toBeHidden();
  });
});
