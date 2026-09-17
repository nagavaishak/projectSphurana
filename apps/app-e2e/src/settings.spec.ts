import { expect, test } from '@playwright/test';

// Per-route smoke for the deep-linked /settings/claire/* pages. CA-3 replaced
// the deferred-port stubs with the real memories + usage feature trees ported
// from apps/web. The smoke confirms the layout + nav render and the real
// content (not the old "deferred" alert) is mounted.
//
// Auth is handled by the `authenticated` project's storageState — no explicit
// sign-in needed.
//
// Boot timing: apps/app needs to fetch /api/runtime-config and resolve
// /auth/session before TanStack Router mounts the route — keep the first
// assertion's timeout generous to absorb that cold-boot latency.

test.describe('2B settings/claire routes', () => {
  test('/settings/claire/usage renders usage dashboard + nav', async ({
    page,
  }) => {
    await page.goto('/settings/claire/usage', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { name: /claire settings/i })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /usage/i })).toBeVisible();
    await expect(page.getByText(/deferred during vite migration/i)).toHaveCount(
      0
    );
    // shadcn's CardTitle / AlertTitle are <div>s, not headings — match by text.
    // The "Daily — last 30 days" card title is unique to the LOADED state, so
    // it is the only acceptable outcome: the usage endpoint must resolve. The
    // error alert ("Couldn't load usage") is a failure of the surface under
    // test, not an alternative pass — assert it is absent.
    await expect(page.getByText(/daily.{0,3}last 30 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/couldn't load usage/i)).toHaveCount(0);
  });

  test('/settings/claire/memories renders memories list', async ({ page }) => {
    await page.goto('/settings/claire/memories', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { name: /claire's memories/i })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/deferred during vite migration/i)).toHaveCount(
      0
    );
  });
});
