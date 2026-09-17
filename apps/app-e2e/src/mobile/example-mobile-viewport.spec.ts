import { expect, test } from '@playwright/test';
import { branchUrl } from '../fixtures/branch.fixture.js';

/**
 * Example mobile-viewport spec (Pillar 2 of the release-safety strategy).
 *
 * Runs under the `authenticated-mobile` project, which loads the Pixel 7
 * device descriptor + the bare-org storageState from `setup-bare`. It is
 * the seed of the real-path mobile-viewport lane: a minimal but real flow
 * (the dashboard home loads on a phone-sized viewport) that proves the
 * project wiring before the campaign-pause / uploaded-vs-generated mobile
 * specs land on top of it.
 *
 * Specs under src/mobile/ are excluded from the desktop `authenticated`
 * project, so this runs exactly once — on the mobile descriptor.
 *
 * NOTE: collect-verified only (resolves under `playwright test --list`).
 * It has not been executed against a preview stack.
 */

test.describe('mobile viewport — dashboard home', () => {
  test('renders the HomeNew surface on a phone-sized viewport', async ({
    page,
  }) => {
    // Sanity-check we are genuinely on the mobile descriptor: the Pixel 7
    // viewport is 412px wide. If this lands on a desktop viewport the
    // project wiring regressed.
    const viewport = page.viewportSize();
    expect(viewport?.width ?? 0).toBeLessThan(600);

    await page.goto(await branchUrl(page, '/dashboard/home'));

    // Greeting heading — "Welcome back, <first name>". This is the same
    // assertion the desktop dashboard spec makes; here it confirms the
    // authenticated surface renders under the mobile layout.
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: /Welcome back,/i })
    ).toBeVisible({ timeout: 15_000 });

    // Today's Update card — always rendered; for the bare user (no
    // appointments / waiting messages) it shows the "all caught up" state.
    await expect(page.getByText("Today's Update", { exact: true })).toBeVisible(
      { timeout: 15_000 }
    );
  });
});
