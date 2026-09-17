import { expect, test } from '@playwright/test';
import { branchUrl } from '../fixtures/branch.fixture.js';

/**
 * apps/app has no cookie consent banner and no onboarding checklist overlay,
 * but we keep this helper as a no-op shim so the test body stays close to the
 * web-e2e original. If a future overlay shows up we can wire it in here.
 */
async function dismissOverlays(_page: import('@playwright/test').Page) {
  // No-op for apps/app — no cookie banner, no checklist widget.
}

/**
 * Get the first channel toggle (aria-label="Toggle chatbot for ...").
 * This skips the targeting switch ("First-time contacts only") which doesn't
 * have a confirmation dialog.
 */
function getChannelToggle(page: import('@playwright/test').Page) {
  return page.getByRole('switch', { name: /toggle chatbot for/i }).first();
}

test.describe('Chatbot — Channels Connected', () => {
  test('shows connected Facebook page with toggle', async ({ page }) => {
    // apps/app: /dashboard/chatbots redirects → /dashboard/settings/chatbot
    await page.goto(await branchUrl(page, '/dashboard/ai-assistant'));
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30000 });

    await test.step('verify channels section is visible', async () => {
      await expect(page.getByText(/channels|connected/i).first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step('verify page toggle exists', async () => {
      const toggle = getChannelToggle(page);
      await expect(toggle).toBeVisible({ timeout: 10000 });
    });
  });

  test('can toggle chatbot on/off for a page', async ({ page }) => {
    await page.goto(await branchUrl(page, '/dashboard/ai-assistant'));
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30000 });
    await dismissOverlays(page);

    const toggle = getChannelToggle(page);
    await expect(toggle).toBeVisible({ timeout: 10000 });

    const wasChecked = await toggle.isChecked();

    // Click the switch — opens a confirmation dialog
    await toggle.click();

    // Confirm in the dialog
    const dialog = page.locator('[role="dialog"]').filter({
      hasText: wasChecked ? /disable/i : /enable/i,
    });
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog
      .getByRole('button', { name: wasChecked ? /disable/i : /enable/i })
      .click();

    // Wait for mutation and dialog to close
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Verify toggled — poll the switch state rather than reading it once after a
    // fixed delay, so a slow enable/disable mutation + refetch doesn't flake.
    const isNowChecked = !wasChecked;
    await expect(toggle).toBeChecked({ checked: isNowChecked, timeout: 10000 });

    // Toggle back to original state
    await toggle.click();
    const restoreDialog = page.locator('[role="dialog"]').filter({
      hasText: isNowChecked ? /disable/i : /enable/i,
    });
    await restoreDialog.waitFor({ state: 'visible', timeout: 10000 });
    await restoreDialog
      .getByRole('button', { name: isNowChecked ? /disable/i : /enable/i })
      .click();
    await restoreDialog.waitFor({ state: 'hidden', timeout: 10000 });

    await expect(toggle).toBeChecked({ checked: wasChecked, timeout: 10000 });
  });
});
