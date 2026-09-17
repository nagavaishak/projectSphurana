import { type Page, test as base, expect } from '@playwright/test';
import { branchUrl } from './branch.fixture.js';
import { isVisibleWithin } from './wait.js';

/**
 * Auth Fixtures and Helpers
 *
 * NOTE: Most tests should NOT need these helpers!
 *
 * The playwright.config.ts is configured with project separation:
 * - "authenticated" tests automatically have stored auth state (via storageState)
 * - "auth-tests" and "smoke-tests" run without stored state
 *
 * Use these helpers only when:
 * - Testing auth flows (sign-in, sign-up tests)
 * - Need to login as a DIFFERENT user mid-test
 * - Testing logout/re-login scenarios
 */

// Test user credentials (from .env.test)
const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'testpassword123',
};

export interface AuthFixtures {
  /**
   * @deprecated Use the default `page` fixture instead.
   * Tests in the "authenticated" project already have auth state.
   * This fixture is kept for backwards compatibility.
   */
  authenticatedPage: Page;
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Check if already authenticated (via storageState)
    await page.goto(await branchUrl(page, '/dashboard/home'));

    // If redirected to sign-in, we need to login
    if (page.url().includes('sign-in')) {
      await page.getByLabel(/email/i).fill(TEST_USER.email);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      await page.waitForURL(/.*dashboard.*/, { timeout: 30000 });
    }

    await use(page);
  },
});

export { expect };

/**
 * Manual login helper
 *
 * Use this in auth tests or when you need to login as a specific user.
 * For most tests, the stored auth state is automatically applied.
 */
export async function loginAs(
  page: Page,
  email: string = TEST_USER.email,
  password: string = TEST_USER.password
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/.*dashboard.*/, { timeout: 30000 });
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Check for sidebar menu button (confirms auth state loaded)
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Logout helper
 */
export async function logout(page: Page): Promise<void> {
  // Try common logout patterns
  const userMenuButton = page.getByRole('button', {
    name: /user menu|profile|account/i,
  });

  if (await isVisibleWithin(userMenuButton, 5000)) {
    await userMenuButton.click();
    await page.getByRole('menuitem', { name: /log out|sign out/i }).click();
  } else {
    // Fallback: navigate directly
    await page.goto('/sign-out');
  }

  await page.waitForURL(/.*sign-in.*/, { timeout: 10000 });
}

/**
 * Ensure user is logged in (for tests that need guaranteed auth state)
 * This is a no-op if the user is already logged in.
 */
export async function ensureLoggedIn(
  page: Page,
  email: string = TEST_USER.email,
  password: string = TEST_USER.password
): Promise<void> {
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    await loginAs(page, email, password);
  }
}
