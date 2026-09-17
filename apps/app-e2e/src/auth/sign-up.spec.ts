import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

/**
 * Ported from apps/web-e2e/src/auth/sign-up.spec.ts.
 *
 * apps/app's sign-up form always renders Name, Email, Password, Confirm
 * Password — no captcha. Exact label lookups dodge the TanStack Router
 * devtools button ("Open match details for /verify-email") and the
 * Password/Confirm Password strict-mode collision.
 */

const TEST_RUN_ID = Date.now();

const fillName = (page: import('@playwright/test').Page, value: string) =>
  page.getByLabel('Name', { exact: true }).fill(value);

const fillConfirmPassword = (
  page: import('@playwright/test').Page,
  value: string
) => page.getByLabel('Confirm Password', { exact: true }).fill(value);

test.describe('Sign Up', () => {
  test.beforeEach(async ({ page }) => {
    // Vite dev cold-compiles each route on first hit; 30s default goto timeout
    // can flake. `domcontentloaded` returns before every chunk is loaded.
    page.setDefaultNavigationTimeout(60_000);
    await page.goto('/sign-up', { waitUntil: 'domcontentloaded' });
  });

  test.describe('Form Display', () => {
    test('displays sign-up form with all required fields', async ({ page }) => {
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: /sign up|create account|register/i })
      ).toBeVisible();
    });

    test('has link to sign-in page', async ({ page }) => {
      const signInLink = page.getByRole('link', {
        name: /sign in|log in|already have/i,
      });
      await expect(signInLink).toBeVisible();
    });
  });

  test.describe('Validation', () => {
    test('shows error for empty email', async ({ page }) => {
      // Fill name to avoid name validation firing first
      await fillName(page, 'Test User');

      await page.getByLabel('Password', { exact: true }).fill('SecurePass123!');
      await fillConfirmPassword(page, 'SecurePass123!');

      await page
        .getByRole('button', { name: /sign up|create account|register/i })
        .click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows error for invalid email format', async ({ page }) => {
      await fillName(page, 'Test User');

      await page.getByLabel('Email', { exact: true }).fill('notanemail');
      await page.getByLabel('Password', { exact: true }).fill('SecurePass123!');
      await fillConfirmPassword(page, 'SecurePass123!');

      await page
        .getByRole('button', { name: /sign up|create account|register/i })
        .click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows error for empty password', async ({ page }) => {
      await fillName(page, 'Test User');

      await page
        .getByLabel('Email', { exact: true })
        .fill('newuser@example.com');
      await page
        .getByRole('button', { name: /sign up|create account|register/i })
        .click();

      await expect(
        page.getByText('Password must be at least 8 characters')
      ).toBeVisible();
    });

    test('shows error for weak password', async ({ page }) => {
      await fillName(page, 'Test User');

      await page
        .getByLabel('Email', { exact: true })
        .fill('newuser@example.com');
      await page.getByLabel('Password', { exact: true }).fill('weak');
      await fillConfirmPassword(page, 'weak');

      await page
        .getByRole('button', { name: /sign up|create account|register/i })
        .click();

      await expect(
        page.getByText('Password must be at least 8 characters')
      ).toBeVisible();
    });

    test('shows error for password mismatch', async ({ page }) => {
      await fillName(page, 'Test User');

      await page
        .getByLabel('Email', { exact: true })
        .fill('newuser@example.com');
      await page.getByLabel('Password', { exact: true }).fill('SecurePass123!');
      await fillConfirmPassword(page, 'DifferentPass456!');
      await page
        .getByRole('button', { name: /sign up|create account|register/i })
        .click();

      await expect(
        page.getByText(/password.*match|passwords.*match/i)
      ).toBeVisible();
    });
  });

  test.describe('Registration', () => {
    test('successful registration sends verification email', async ({
      page,
      request,
    }) => {
      test.setTimeout(90_000);
      const seed = new SeedHelper(page, request);

      // Use unique e2e.test.* email so global teardown can clean it up
      const uniqueEmail = `e2e.test.signup.${TEST_RUN_ID}@example.com`;

      await fillName(page, 'E2E Signup Test');

      await page.getByLabel('Email', { exact: true }).fill(uniqueEmail);
      await page.getByLabel('Password', { exact: true }).fill('SecurePass123!');
      await fillConfirmPassword(page, 'SecurePass123!');

      // Wait for Turnstile captcha to complete (if present)
      const submitButton = page.getByRole('button', {
        name: /sign up|create account|register/i,
      });
      await expect(submitButton).toBeEnabled({ timeout: 15000 });
      await submitButton.click();

      // Must redirect to verify-email / onboarding / dashboard. A sign-up that
      // stays put IS the regression — the old code skipped here (blaming
      // Turnstile), which turned "sign-up is broken" into a green run. The API
      // skips captcha validation outside production and the submit button is
      // only enabled once the captcha token is in state (asserted above), so a
      // non-navigation here is a real failure.
      // Pathname only — a preview host embeds the branch name, so matching the
      // full URL lets a branch called `*-onboarding-*` satisfy this instantly.
      await page.waitForURL(
        (url) =>
          /^\/(verify-email|onboarding|welcome|dashboard)/.test(url.pathname),
        { timeout: 30_000 }
      );

      // Verify that a verification token was generated (proves the sign-up
      // triggered the verification email flow and stored the token in Redis).
      // The auth server persists it asynchronously, so poll the real condition
      // rather than sleeping between attempts.
      await expect
        .poll(() => seed.getVerificationToken(uniqueEmail).catch(() => ''), {
          message: `No verification token was ever stored for ${uniqueEmail}`,
          timeout: 30_000,
          intervals: [2_000],
        })
        .not.toBe('');
    });

    test('shows error for duplicate email', async ({ page }) => {
      await fillName(page, 'Duplicate Test');

      // Use the seeded bare user — `existingUser` falls back to a fake
      // address if TEST_USER_EMAIL isn't set, which doesn't trip the dup check.
      await page
        .getByLabel('Email', { exact: true })
        .fill(TEST_DATA.bareUser.email);
      await page.getByLabel('Password', { exact: true }).fill('SecurePass123!');
      await fillConfirmPassword(page, 'SecurePass123!');

      // Wait for Turnstile captcha to complete (if present)
      const submitButton = page.getByRole('button', {
        name: /sign up|create account|register/i,
      });
      await expect(submitButton).toBeEnabled({ timeout: 15000 });
      await submitButton.click();

      await expect(
        page
          .getByText(
            /already exists|already registered|email.*taken|failed to create account/i
          )
          .first()
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Navigation', () => {
    test('navigates to sign-in page', async ({ page }) => {
      await page
        .getByRole('link', { name: /sign in|log in|already have/i })
        .click();
      await expect(page).toHaveURL(/sign-in/);
    });
  });

  test.describe('Accessibility', () => {
    test('form fields have proper labels', async ({ page }) => {
      // Loose /email/i collides with the TanStack Router devtools button.
      const emailInput = page.getByLabel('Email', { exact: true });
      await expect(emailInput).toHaveAttribute('type', 'email');
    });

    test('password field is of type password', async ({ page }) => {
      // apps/app sign-up has Password AND Confirm Password — use exact label
      // to avoid strict-mode multi-match on the loose regex.
      const passwordInput = page.getByLabel('Password', { exact: true });
      await expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });
});
