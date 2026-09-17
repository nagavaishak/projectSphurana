import { expect, test } from '@playwright/test';
import { branchUrl, branchUrlPattern } from './fixtures/branch.fixture.js';

/**
 * /dashboard home (HomeNew surface).
 *
 * apps/app has no `dashboard/index` page — `/dashboard` redirects to
 * `/dashboard/home`, which renders `HomeNew` (see
 * apps/app/src/routes/_authed/dashboard/-components/home-new.tsx).
 *
 * The `authenticated` project loads storageState from `setup-bare`, so
 * just navigate — no per-test sign-in.
 *
 * Other dashboard sub-routes (getting-started, brand, integrations,
 * deposits, debug, voice-test, team/practitioners) are covered by
 * their own feature specs.
 */

test.describe('dashboard home', () => {
  test('/dashboard redirects to /dashboard/home', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(branchUrlPattern('home$'), {
      timeout: 15_000,
    });
  });

  test('renders the HomeNew surface for the bare user', async ({ page }) => {
    await page.goto(await branchUrl(page, '/dashboard/home'));

    // Greeting heading — "Welcome back, <first name>".
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: /Welcome back,/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText(/here's your update for today/i)).toBeVisible();

    // Today's Update card — always rendered; for the bare user (no
    // appointments / waiting messages) it shows the "all caught up" state.
    await expect(page.getByText("Today's Update", { exact: true })).toBeVisible(
      { timeout: 15_000 }
    );

    // HomePrompt — quick actions + textarea launch the assistant. Create
    // Graphic is not built yet, so the home prompt ships three quick
    // actions (see home-prompt.tsx QUICK_ACTIONS).
    await expect(
      page.getByRole('button', { name: 'Create Video' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Launch Ad' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Summarise Conversations' })
    ).toBeVisible();

    await expect(
      page.getByPlaceholder(/ask me what you want to do/i)
    ).toBeVisible();

    // NOTE: "Today's Recommendations" renders null when the org has no active
    // recommendations, and nothing in this suite seeds one — the previous
    // `if (visible) expect(visible)` guard here was a tautology that asserted
    // nothing either way, so it is gone. If we want coverage of that card, a
    // test must SEED a recommendation and then assert it renders.
  });
});
