import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — Shifts (weekly roster). Broad-shallow, viewport-agnostic: the same
 * flow runs on desktop (`tabs`) and mobile (`tabs-mobile`). A fresh org reaches
 * the surface authenticated and sees the roster heading, and a seeded
 * practitioner appears as a team-member row in the weekly grid.
 *
 * Readiness is asserted on content (the "Scheduled shifts" heading / seeded name)
 * rather than shell chrome, because team routes render no mobile bottom-tab nav
 * (see members.spec.ts for the full note).
 */
test.describe('Team · shifts', () => {
  test('a fresh org reaches the shifts page authenticated', async ({ org }) => {
    const { page } = org;
    await page.goto(await branchUrl(page, '/dashboard/team/shifts'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(branchUrlPattern('team/shifts'));
    // The page's own heading — but the COPY differs by viewport, because the
    // route renders two different components: desktop is the weekly roster
    // (<h1>Scheduled shifts</h1>), mobile is the day roster, whose title comes
    // from the mobile dashboard header (<h1>Shifts</h1>). Asserting the
    // desktop-only string here was simply wrong on mobile, not a bug in the app.
    // `/shifts/i` still requires the page to render its identifying heading at
    // both viewports — it just stops asserting desktop copy against mobile.
    await expect(
      page.getByRole('heading', { name: /shifts/i }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('a seeded practitioner appears as a team-member row in the roster', async ({
    org,
  }) => {
    const { page, seed } = org;
    const name = `E2E Shift ${Date.now()}`;
    await seed.createPractitioner({
      name,
      email: `e2e.shift.${Date.now()}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/shifts'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
  });
});
