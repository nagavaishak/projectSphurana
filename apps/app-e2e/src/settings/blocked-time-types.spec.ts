import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Blocked time types — read round-trip. Seed a type through the org's
 * own authenticated session (cookie-authed, org-scoped) so the spec drives only
 * the surface under test, then assert it renders in the table.
 */
test.describe('Settings · blocked time types', () => {
  test('a blocked time type seeded via the API renders in the table', async ({
    org,
  }) => {
    const { page, seed, orgId } = org;
    const name = `E2E Blocked ${Date.now()}`;

    // Blocked-time-types read/write is gated behind a paid plan.
    await seed.forceCreateSubscription(orgId);

    await seed.authenticatedApiCall('POST', '/blocked-time-types', {
      name,
      durationMinutes: 30,
      paid: false,
    });

    await gotoSurface(page, '/dashboard/settings/blocked-time-types');

    await expect(
      page.getByRole('heading', { name: /Blocked time types/i })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  });
});
