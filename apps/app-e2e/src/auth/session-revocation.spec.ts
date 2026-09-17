import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { API_URL, SeedHelper, branchUrl } from '../fixtures/index.js';

/**
 * Password reset must terminate every existing session.
 *
 * A reset is what someone does when they have LOST control of the credential.
 * If sessions survive it, an attacker holding a stolen session cookie keeps
 * access after the victim resets — the victim's one available remedy changes
 * the password and does nothing about the intruder.
 *
 * better-auth defaults `revokeSessionsOnPasswordReset` to OFF; it is switched
 * on in `packages/auth/src/server.ts`. These tests are the behavioural proof,
 * and they matter more than usual here because our sessions live ONLY in
 * Redis (`secondaryStorage`) — the `session` table is empty in production, so
 * a revoke that only cleared the database would look correct in code review
 * and be a complete no-op in practice.
 *
 * Two browser contexts stand in for two devices: `deviceA` is the session
 * that must die, `deviceB` performs the reset.
 */
test.describe('Password reset revokes existing sessions', () => {
  test.setTimeout(180_000);

  let deviceA: BrowserContext;
  let deviceB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    deviceA = await browser.newContext();
    deviceB = await browser.newContext();
    pageA = await deviceA.newPage();
    pageB = await deviceB.newPage();
    pageA.setDefaultNavigationTimeout(60_000);
    pageB.setDefaultNavigationTimeout(60_000);
  });

  test.afterAll(async () => {
    await deviceA?.close();
    await deviceB?.close();
  });

  test('a session open on another device cannot survive the reset', async ({
    request,
  }) => {
    const seedA = new SeedHelper(pageA, request);
    const seedB = new SeedHelper(pageB, request);
    const testRunId = Date.now();
    const testUser = {
      name: 'E2E Session Revocation User',
      email: `e2e.test.reset.${testRunId}@example.com`,
      password: 'OriginalPassword123!',
    };
    const newPassword = 'NewSecurePassword456!';

    await test.step('create and verify the user', async () => {
      await seedA.signUpViaApi(testUser);
      await seedA.verifyEmail(testUser.email);
    });

    await test.step('device A signs in and reaches the app', async () => {
      await seedA.signInUser(testUser.email, testUser.password);

      await expect(pageA).toHaveURL(
        /dashboard|onboarding|billing|verify-email/,
        { timeout: 30_000 }
      );
    });

    await test.step('device B resets the password', async () => {
      await pageB.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
      await pageB.getByLabel('Email', { exact: true }).fill(testUser.email);
      await pageB.getByRole('button', { name: /reset|send|submit/i }).click();

      await expect(
        pageB.getByRole('heading', { name: /check your email/i })
      ).toBeVisible({ timeout: 30_000 });

      const resetLink = await seedB.getResetLink(testUser.email);
      expect(resetLink).toBeTruthy();

      await pageB.goto(resetLink, { waitUntil: 'domcontentloaded' });
      await pageB.getByLabel('New Password', { exact: true }).fill(newPassword);
      await pageB.getByRole('button', { name: /reset|update|change/i }).click();

      await expect(
        pageB.getByRole('heading', { name: /password reset/i })
      ).toBeVisible({ timeout: 30_000 });
    });

    await test.step("device A's session is dead", async () => {
      // THE assertion. Device A never touched the reset and still holds its
      // cookie — the server must now refuse it. Navigating to a protected
      // route is the honest check: it exercises the same guard a real
      // intruder would hit.
      await pageA.goto(await branchUrl(pageA, '/dashboard/home'), {
        waitUntil: 'domcontentloaded',
      });

      await expect(pageA).toHaveURL(/sign-in/, { timeout: 30_000 });
    });

    await test.step('the server rejects the stale cookie, not just the UI', async () => {
      // A client-side redirect could be cosmetic. Ask the API directly with
      // device A's cookie jar: the session must be gone server-side too.
      const response = await pageA.request.get(`${API_URL}/auth/session`);
      const body = (await response.json().catch(() => null)) as {
        user?: unknown;
      } | null;

      expect(body?.user ?? null).toBeNull();
    });

    await test.step('the new password still works', async () => {
      // Revocation must not have broken the reset itself.
      await seedA.signInUser(testUser.email, newPassword);

      await expect(pageA).toHaveURL(
        /dashboard|onboarding|billing|verify-email/,
        { timeout: 30_000 }
      );
    });

    await test.step('cleanup test user', async () => {
      await seedA.cleanup(`e2e.test.reset.${testRunId}%`);
    });
  });
});
