import { gotoSurface } from '../fixtures/app.js';
import { branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Home tab. Broad-shallow, viewport-agnostic: a fresh org can reach the Home
 * dashboard (proves per-test-org auth + navigation), the default `/dashboard`
 * route redirects to the authed home, and the home overview renders its stable
 * greeting, "Today's Update" card, and Claire prompt launcher.
 *
 * Runs through TWO projects — `tabs` (Desktop Chrome) and `tabs-mobile`
 * (Pixel 7) — off the SAME spec file. `gotoSurface`/`expectAppReady` absorb the
 * desktop-sidebar vs mobile-bottom-tab chrome difference. Content assertions
 * anchor on texts that render at BOTH viewports; genuinely desktop-only widgets
 * are guarded with `test.skip(isMobile(page), ...)`.
 */
test.describe('Home · dashboard', () => {
  test('a fresh org reaches the home dashboard authenticated', async ({
    org,
  }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/home');
    // If auth failed we'd be bounced to /sign-in; asserting the URL held proves
    // the per-test-org session is live (app shell readiness checked in
    // gotoSurface, viewport-agnostic).
    await expect(page).toHaveURL(branchUrlPattern('home'));

    // Greeting heading — "Welcome back, <first name>" (level-1 heading). Renders
    // on both the desktop `HomeNew` overview and the mobile home layout.
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: /Welcome back,/i })
    ).toBeVisible({ timeout: 15_000 });

    // "Today's Update" card is always rendered; for a fresh empty org it shows
    // the "all caught up" state.
    await expect(page.getByText("Today's Update", { exact: true })).toBeVisible(
      { timeout: 15_000 }
    );
  });

  test('the default /dashboard route resolves to the authed home', async ({
    org,
  }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard');
    // `/dashboard` (no page) redirects to `/dashboard/home`. Landing on the
    // authed home — and not `/sign-in` — proves the redirect + session hold.
    await expect(page).toHaveURL(branchUrlPattern('home'), { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test('the home overview renders its stable widgets', async ({ org }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/home');

    // Sub-greeting line under the heading.
    await expect(page.getByText("Here's your update for today")).toBeVisible({
      timeout: 15_000,
    });

    // The Claire prompt launcher pinned to the bottom of the home screen —
    // its textarea placeholder is a stable anchor for the widget.
    await expect(
      page.getByPlaceholder('Ask me what you want to do...')
    ).toBeVisible({ timeout: 15_000 });

    // ...and its "Recents" launcher control into the assistant.
    await expect(page.getByRole('button', { name: 'Recents' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
