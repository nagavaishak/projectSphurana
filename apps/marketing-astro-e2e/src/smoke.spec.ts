import { expect, test } from '@playwright/test';

// Basic smoke coverage for the Astro marketing site: pages render, the
// shell (navbar + footer) mounts, navigation works, the 404 is served,
// and the Sentry reverse-proxy route is wired up.
test.describe('marketing-astro · smoke', () => {
  test('home page renders with shell', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Borradh/);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();

    // Navbar CTA + footer confirm the marketing shell hydrated.
    await expect(
      page.getByRole('link', { name: /book a demo/i }).first()
    ).toBeVisible();
    await expect(page.getByText(/all rights reserved/i)).toBeVisible();
  });

  test('core marketing pages render', async ({ page }) => {
    for (const path of ['/pricing', '/about', '/how-it-works', '/contact']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
  });

  test('navigation between pages works', async ({ page }) => {
    await page.goto('/');

    await page
      .getByRole('link', { name: 'Pricing', exact: true })
      .first()
      .click();

    await expect(page).toHaveURL(/\/pricing\/?$/);
    await expect(
      page.getByRole('heading', { name: /pricing/i }).first()
    ).toBeVisible();
  });

  test('unknown route serves the 404 page', async ({ page }) => {
    await page.goto('/no-such-page-xyz');

    await expect(
      page.getByRole('heading', { name: /page not found/i })
    ).toBeVisible();
  });

  test('does not expose the server-side error debug routes', async ({
    request,
  }) => {
    // A publicly reachable route that deliberately throws turns a monitoring
    // smoke test into a production incident — Sentry MARKETING-4 was exactly
    // that. Keep the exact routes that emitted it covered, rather than only
    // checking an unrelated unknown path.
    //
    // This runs against a PREVIEW, which is the point: previews used to serve
    // these (the old gate only closed on production), so a 404 here proves the
    // `DEBUG_ENDPOINTS_ENABLED` flag is what opens them, not the environment.
    // Both variants are checked because Astro routes an endpoint throw and a
    // page throw through different machinery.
    for (const path of ['/debug/server-error', '/debug/server-error-page']) {
      const res = await request.get(path);

      expect(res.status(), `${path} must not be reachable`).toBe(404);
    }
  });

  test('Sentry tunnel reverse proxy is reachable', async ({ request }) => {
    // An empty POST exercises the proxy handler. The exact rejection
    // depends on the target env: 404 "not configured" with no DSN (local
    // dev), 400 "invalid envelope" when a DSN is set (deployed preview).
    // Either way it proves our handler ran — not a missing route.
    const res = await request.post('/monitoring', { data: '' });

    expect([400, 404]).toContain(res.status());
    expect(await res.text()).toMatch(
      /sentry tunnel not configured|invalid envelope/i
    );
  });
});
