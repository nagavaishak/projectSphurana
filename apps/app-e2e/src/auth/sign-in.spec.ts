import { expect, test } from '@playwright/test';
import { expectAppReady } from '../fixtures/app.js';
import { TEST_DATA, branchUrl } from '../fixtures/index.js';

/**
 * Ported from apps/web-e2e/src/auth/sign-in.spec.ts.
 *
 * apps/app is a Vite SPA with cookie-session auth — no cookie consent banner, no SSR
 * redirect cycle. The sign-in form, labels, and validation messages are
 * unchanged from apps/web, so the spec is otherwise a verbatim port.
 */

test.describe('Sign In', () => {
  test.beforeEach(async ({ page }) => {
    // Vite dev cold-compiles each route on first hit; 30s default goto timeout
    // can flake. `domcontentloaded` returns before every chunk is loaded.
    page.setDefaultNavigationTimeout(60_000);
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
  });

  test.describe('Form Display', () => {
    test('displays sign-in form with all required fields', async ({ page }) => {
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: /sign in|log in/i })
      ).toBeVisible();
    });

    test('has link to sign-up page', async ({ page }) => {
      const signUpLink = page.getByRole('link', {
        name: /sign up|create account|register/i,
      });
      await expect(signUpLink).toBeVisible();
    });

    test('has link to forgot password', async ({ page }) => {
      const forgotLink = page.getByRole('link', { name: /forgot|reset/i });
      await expect(forgotLink).toBeVisible();
    });
  });

  test.describe('Validation', () => {
    test('shows error for empty email', async ({ page }) => {
      await page.getByLabel('Password', { exact: true }).fill('somepassword');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows error for invalid email format', async ({ page }) => {
      await page.getByLabel('Email', { exact: true }).fill('notanemail');
      await page.getByLabel('Password', { exact: true }).fill('somepassword');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows error for empty password', async ({ page }) => {
      await page.getByLabel('Email', { exact: true }).fill('test@example.com');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page.getByText('Password is required')).toBeVisible();
    });
  });

  test.describe('Authentication', () => {
    test('successful sign-in authenticates and renders the app', async ({
      page,
    }) => {
      await page
        .getByLabel('Email', { exact: true })
        .fill(TEST_DATA.bareUser.email);
      await page
        .getByLabel('Password', { exact: true })
        .fill(TEST_DATA.bareUser.password);
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      // Leaving /sign-in is necessary but NOWHERE near sufficient — the old
      // 5-way waitForURL would have gone green on a user parked forever on
      // /billing. Assert the session is real by driving the authenticated app:
      // /dashboard/home bounces an unauthenticated visitor straight back to
      // /sign-in, so a rendered app shell there proves the sign-in worked.
      // Match on the PATHNAME, not the whole URL. `waitForURL` tests the full
      // href — and a Vercel preview host embeds the branch name, so on a branch
      // like `feat/onboarding-cleanup` the host itself contains "onboarding"
      // and this wait resolved INSTANTLY, before sign-in had done anything.
      // The test then navigated away and aborted the in-flight sign-in POST
      // (net::ERR_ABORTED in the trace), so no session cookie was ever set.
      await page.waitForURL(
        (url) =>
          /^\/(dashboard|home|onboarding|welcome|billing|setup)/.test(
            url.pathname
          ),
        { timeout: 30_000 }
      );

      await page.goto(await branchUrl(page, '/dashboard/home'), {
        waitUntil: 'domcontentloaded',
      });
      await expectAppReady(page);
      await expect(page).toHaveURL(/dashboard/);
    });

    test('shows error for invalid credentials', async ({ page }) => {
      await page
        .getByLabel('Email', { exact: true })
        .fill('nonexistent@example.com');
      await page.getByLabel('Password', { exact: true }).fill('wrongpassword');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      // Better Auth round-trip + toast render can take well over the default
      // 5s on a cold Vite cache.
      await expect(
        page.getByText(/invalid|incorrect|wrong|failed to sign in/i).first()
      ).toBeVisible({ timeout: 20_000 });
    });

    test('shows error for wrong password', async ({ page }) => {
      await page
        .getByLabel('Email', { exact: true })
        .fill(TEST_DATA.bareUser.email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('definitelywrongpassword');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(
        page.getByText(/invalid|incorrect|wrong|failed to sign in/i).first()
      ).toBeVisible({ timeout: 20_000 });
    });
  });

  test.describe('Navigation', () => {
    test('navigates to sign-up page', async ({ page }) => {
      await page
        .getByRole('link', { name: /sign up|create account|register/i })
        .click();
      await expect(page).toHaveURL(/sign-up/, { timeout: 30000 });
    });

    test('navigates to forgot password page', async ({ page }) => {
      await page.getByRole('link', { name: /forgot|reset/i }).click();
      await expect(page).toHaveURL(/forgot/, { timeout: 30000 });
    });
  });

  test.describe('Accessibility', () => {
    test('form fields have proper labels', async ({ page }) => {
      // Loose /email/i collides with the TanStack Router devtools button
      // ("Open match details for /verify-email"); use exact labels.
      const emailInput = page.getByLabel('Email', { exact: true });
      const passwordInput = page.getByLabel('Password', { exact: true });

      // beforeEach navigates with `domcontentloaded`, so the form may not be
      // rendered yet by the time this test starts. Bump the attribute timeout.
      await expect(emailInput).toHaveAttribute('type', 'email', {
        timeout: 15_000,
      });
      await expect(passwordInput).toHaveAttribute('type', 'password');
    });

    test('submit button is focusable', async ({ page }) => {
      const submitButton = page.getByRole('button', {
        name: /sign in|log in/i,
      });
      await submitButton.focus();
      await expect(submitButton).toBeFocused();
    });
  });
});
