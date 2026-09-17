import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Details — the cheap mutation: rename the organisation and assert it
 * persists. The Details page reads `GET /organizations/:id` (and `/:id/members`)
 * and writes `PUT /organizations/:id`. The backing feature schemas
 * (`getOrganizationSchema`, `getOrganizationMembersSchema`) now validate the id
 * with `z.string().min(1)` (matching `getOrganizationBrandSchema`), so the
 * `e2e_test_`-prefixed fixture org id is accepted and the page hydrates.
 */
test.describe('Settings · details mutation', () => {
  test('renaming the organisation persists', async ({ org }) => {
    const { page, seed, orgId } = org;
    const newName = `E2E Org ${Date.now()}`;

    await seed.forceCreateSubscription(orgId);
    await page.goto('/dashboard/settings/details', {
      waitUntil: 'domcontentloaded',
    });

    const nameInput = page.getByLabel(/Organisation name/i);
    await expect(nameInput).toBeVisible({ timeout: 20_000 });
    await expect(nameInput).not.toHaveValue('', { timeout: 15_000 });

    await nameInput.fill(newName);
    await page.getByRole('button', { name: /Save changes/i }).click();

    await page.goto('/dashboard/settings/details', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByLabel(/Organisation name/i)).toHaveValue(newName, {
      timeout: 20_000,
    });
  });
});
