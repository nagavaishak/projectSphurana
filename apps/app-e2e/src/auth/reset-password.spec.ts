import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

/**
 * Ported from apps/web-e2e/src/auth/reset-password.spec.ts.
 *
 * apps/app differences:
 *  - The reset-password form has a SINGLE "New Password" field — no Confirm
 *    field. The mismatch test below short-circuits via the existing
 *    confirm-field visibility check.
 *  - Cookie-session auth — the "request password
 *    reset" step clears storage rather than cookies before re-navigating.
 */

test.describe('Password Reset', () => {
  test.beforeEach(async ({ page }) => {
    // Vite dev cold-compiles each route on first hit; bump the navigation
    // timeout so cold-route gotos don't flake at 30s.
    page.setDefaultNavigationTimeout(60_000);
  });

  test.describe('Forgot Password Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    });

    test('displays forgot password form', async ({ page }) => {
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: /reset|send|submit/i })
      ).toBeVisible();
    });

    test('has link back to sign in', async ({ page }) => {
      const signInLink = page.getByRole('link', {
        name: /sign in|log in|back/i,
      });
      await expect(signInLink).toBeVisible();
    });
  });

  test.describe('Request Reset', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    });

    test('shows error for empty email', async ({ page }) => {
      await page.getByRole('button', { name: /reset|send|submit/i }).click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows error for invalid email format', async ({ page }) => {
      await page.getByLabel('Email', { exact: true }).fill('notanemail');
      await page.getByRole('button', { name: /reset|send|submit/i }).click();

      await expect(page.getByText('Invalid email format')).toBeVisible();
    });

    test('shows success message for valid email', async ({ page }) => {
      await page
        .getByLabel('Email', { exact: true })
        .fill(TEST_DATA.existingUser.email);
      await page.getByRole('button', { name: /reset|send|submit/i }).click();

      // Should show success message (even for non-existent emails for security)
      await expect(
        page.getByRole('heading', { name: /check your email/i })
      ).toBeVisible();
    });

    test('shows success for non-existent email (security)', async ({
      page,
    }) => {
      // For security, should not reveal if email exists
      await page
        .getByLabel('Email', { exact: true })
        .fill('nonexistent@example.com');
      await page.getByRole('button', { name: /reset|send|submit/i }).click();

      // Should show same success message as valid email
      await expect(
        page.getByRole('heading', { name: /check your email/i })
      ).toBeVisible();
    });

    test('generates real reset email and shows form', async ({
      page,
      request,
    }) => {
      test.setTimeout(90_000);
      const seed = new SeedHelper(page, request);

      // Use the seeded bare user — `existingUser` falls back to a non-existent
      // address if TEST_USER_EMAIL isn't set, which silently no-ops the reset
      // request (security feature) and never generates a token.
      const realEmail = TEST_DATA.bareUser.email;

      await page.getByLabel('Email', { exact: true }).fill(realEmail);
      await page.getByRole('button', { name: /reset|send|submit/i }).click();

      // Wait for "Check your email" confirmation
      await expect(
        page.getByRole('heading', { name: /check your email/i })
      ).toBeVisible({ timeout: 10000 });

      // Get the reset link via testing API
      const resetLink = await seed.getResetLink(realEmail);
      expect(resetLink).toBeTruthy();

      // Navigate to the reset link
      await page.goto(resetLink, { waitUntil: 'domcontentloaded' });

      // The token came straight from the API, so the ONLY correct outcome is
      // the reset form. (The old assertion accepted "form OR invalid-token
      // error", i.e. it also passed when a freshly-minted token was rejected —
      // exactly the regression this test exists to catch.)
      await expect(
        page.getByLabel('New Password', { exact: true })
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/invalid or expired link/i)).toBeHidden();
    });
  });

  test.describe('Reset Password Page', () => {
    test('shows error for invalid reset token', async ({ page }) => {
      // Better Auth redirects invalid tokens to ?error=INVALID_TOKEN
      await page.goto('/reset-password?error=INVALID_TOKEN', {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByText(/Invalid or expired link/i)).toBeVisible({
        timeout: 30_000,
      });
    });

    test('shows error when no token provided', async ({ page }) => {
      await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });

      await expect(page.getByText(/Invalid or expired link/i)).toBeVisible({
        timeout: 30_000,
      });
    });
  });

  test.describe('Password Reset Form', () => {
    /**
     * There is no "passwords don't match" test because there is nothing to
     * mismatch: apps/app's reset form ships a SINGLE "New Password" field
     * (apps/app/src/routes/reset-password.tsx). The ported apps/web test for
     * that error self-skipped on the missing Confirm field on every run, i.e.
     * it asserted nothing. This asserts the form's real shape instead — if a
     * Confirm field is ever added, this fails and mismatch coverage must be
     * written for real.
     *
     * The route only shows the invalid-link screen when the token is ABSENT or
     * `?error=INVALID_TOKEN` is set; any non-empty token renders the form, so
     * `?token=test-token` deterministically gets us the form for the
     * client-side validation checks below (the token is only spent on submit).
     */
    test('reset form ships a single password field (no confirm field)', async ({
      page,
    }) => {
      await page.goto('/reset-password?token=test-token', {
        waitUntil: 'domcontentloaded',
      });

      await expect(
        page.getByLabel('New Password', { exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByLabel('Confirm Password', { exact: true })
      ).toHaveCount(0);
    });

    test('shows error for weak password', async ({ page }) => {
      await page.goto('/reset-password?token=test-token', {
        waitUntil: 'domcontentloaded',
      });

      const newPassword = page.getByLabel('New Password', { exact: true });
      await expect(newPassword).toBeVisible({ timeout: 15_000 });

      await newPassword.fill('weak');
      await page.getByRole('button', { name: /reset|update|change/i }).click();

      await expect(
        page.getByText('Password must be at least 8 characters')
      ).toBeVisible();
    });
  });

  test.describe('Full Password Reset Flow', () => {
    test.setTimeout(120_000);

    test('completes full password reset and signs in with new password', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);
      const testRunId = Date.now();
      const testUser = {
        name: 'E2E Reset User',
        email: `e2e.test.reset.${testRunId}@example.com`,
        password: 'OriginalPassword123!',
      };
      const newPassword = 'NewSecurePassword456!';

      await test.step('create and verify test user', async () => {
        await seed.signUpViaApi(testUser);
        await seed.verifyEmail(testUser.email);
      });

      await test.step('request password reset', async () => {
        // Deliberately exercises the SIGNED-OUT path — the ordinary case of
        // someone locked out on the device they're using. The signed-in path
        // is covered separately in "Recovery while signed in" below; it used
        // to be impossible, which is why this line originally existed as a
        // workaround rather than a choice.
        await page.context().clearCookies();
        await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Email', { exact: true }).fill(testUser.email);
        await page.getByRole('button', { name: /reset|send|submit/i }).click();

        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('get reset link and navigate to it', async () => {
        // No sleep: getResetLink already polls the testing endpoint (20 × 2s)
        // until better-auth has persisted the reset verification record.
        const resetLink = await seed.getResetLink(testUser.email);
        expect(resetLink).toBeTruthy();

        await page.goto(resetLink, { waitUntil: 'domcontentloaded' });

        // Should show the password reset form, not an error
        const passwordField = page.getByLabel('New Password', { exact: true });
        await expect(passwordField).toBeVisible({ timeout: 10000 });
      });

      await test.step('submit new password', async () => {
        // Single-field form — see the "no confirm field" test above.
        await page
          .getByLabel('New Password', { exact: true })
          .fill(newPassword);

        await page
          .getByRole('button', { name: /reset|update|change/i })
          .click();

        // apps/app renders an h1 "Password reset" success view (the route only
        // flips to it after the API returns 200 — so this IS the "password
        // persisted" signal; no sleep needed before signing in below).
        await expect(
          page.getByRole('heading', { name: /password reset/i })
        ).toBeVisible({ timeout: 30_000 });
      });

      await test.step('sign in with new password', async () => {
        // Delegate to the SeedHelper sign-in flow so we get the same retry +
        // post-auth handling as setup-bare.
        await seed.signInUser(testUser.email, newPassword);

        // Should land on a post-auth route (un-onboarded users → /onboarding).
        await expect(page).toHaveURL(
          /dashboard|onboarding|billing|verify-email/,
          { timeout: 30_000 }
        );
      });

      await test.step('cleanup test user', async () => {
        await seed.cleanup(`e2e.test.reset.${testRunId}%`);
      });
    });
  });

  /**
   * REGRESSION COVERAGE — recovery routes must work with a live session.
   *
   * /reset-password and /forgot-password used to redirect any visitor holding
   * a session to their post-auth landing page, exactly like /sign-in. That
   * silently ate emailed reset links: better-auth's changePassword leaves the
   * current session intact, so the device a customer reads email on stays
   * signed in while they're locked out everywhere else. Clicking the link
   * there dropped them on the dashboard and the form never rendered.
   *
   * This suite never caught it because the flow test above CLEARED COOKIES to
   * work around the redirect — it only ever tested the signed-out path. These
   * tests keep a session deliberately.
   */
  test.describe('Recovery while signed in', () => {
    test.setTimeout(120_000);

    test('a signed-in user can open a reset link and complete the reset', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);
      const testRunId = Date.now();
      const testUser = {
        name: 'E2E Signed-In Reset User',
        email: `e2e.test.reset.${testRunId}@example.com`,
        password: 'OriginalPassword123!',
      };
      const newPassword = 'NewSecurePassword456!';

      await test.step('create a verified, signed-in user', async () => {
        await seed.signUpViaApi(testUser);
        await seed.verifyEmail(testUser.email);
        // The session is the whole point — establish it and keep it.
        await seed.signInUser(testUser.email, testUser.password);
      });

      await test.step('request a reset without dropping the session', async () => {
        await page.goto('/forgot-password', {
          waitUntil: 'domcontentloaded',
        });

        // Reaching the form at all is the first half of the fix: a session
        // holder used to be bounced straight to /dashboard/home from here.
        await expect(page.getByLabel('Email', { exact: true })).toBeVisible({
          timeout: 30_000,
        });

        await page.getByLabel('Email', { exact: true }).fill(testUser.email);
        await page.getByRole('button', { name: /reset|send|submit/i }).click();

        await expect(
          page.getByRole('heading', { name: /check your email/i })
        ).toBeVisible({ timeout: 30_000 });
      });

      await test.step('confirmation names the address it was sent to', async () => {
        // Guards the second fix: a customer who types an address with no
        // account must be able to SEE which address we acted on.
        await expect(page.getByText(testUser.email)).toBeVisible();
      });

      await test.step('the reset link renders the form, not the dashboard', async () => {
        const resetLink = await seed.getResetLink(testUser.email);
        expect(resetLink).toBeTruthy();

        await page.goto(resetLink, { waitUntil: 'domcontentloaded' });

        // THE regression assertion. Before the fix this URL became
        // /dashboard/home and the password field never existed.
        await expect(
          page.getByLabel('New Password', { exact: true })
        ).toBeVisible({ timeout: 30_000 });
        await expect(page).toHaveURL(/reset-password/);
      });

      await test.step('the reset actually goes through', async () => {
        await page
          .getByLabel('New Password', { exact: true })
          .fill(newPassword);
        await page
          .getByRole('button', { name: /reset|update|change/i })
          .click();

        await expect(
          page.getByRole('heading', { name: /password reset/i })
        ).toBeVisible({ timeout: 30_000 });
      });

      await test.step('the new password is the one that works', async () => {
        // Resetting a password does NOT revoke the session that was already
        // open — better-auth leaves existing sessions alone unless told
        // otherwise, and this test is signed in throughout by design. Without
        // an explicit sign-out, `signInUser` sees a session that already
        // belongs to this user, short-circuits, and never navigates: the
        // assertion below would then be checking a page we never left rather
        // than the new credential. Drop the session first so the sign-in is
        // real.
        await seed.signOut();
        await seed.signInUser(testUser.email, newPassword);

        // A success screen only proves the request was accepted. Signing in
        // from a clean slate is the proof the new password persisted.
        await expect(page).toHaveURL(
          /dashboard|onboarding|billing|verify-email/,
          { timeout: 30_000 }
        );
      });

      await test.step('cleanup test user', async () => {
        await seed.cleanup(`e2e.test.reset.${testRunId}%`);
      });
    });

    test('an expired link shows the invalid-link screen to a signed-in user', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);
      const testRunId = Date.now();
      const testUser = {
        name: 'E2E Expired Link User',
        email: `e2e.test.reset.${testRunId}@example.com`,
        password: 'OriginalPassword123!',
      };

      await test.step('create a verified, signed-in user', async () => {
        await seed.signUpViaApi(testUser);
        await seed.verifyEmail(testUser.email);
        await seed.signInUser(testUser.email, testUser.password);
      });

      await test.step('an expired link explains itself instead of redirecting', async () => {
        // better-auth bounces a dead token back with ?error=INVALID_TOKEN.
        // That must reach the component — redirecting a session holder here
        // is the same silent dead end from the customer's side.
        await page.goto('/reset-password?error=INVALID_TOKEN', {
          waitUntil: 'domcontentloaded',
        });

        await expect(page.getByText(/invalid or expired link/i)).toBeVisible({
          timeout: 30_000,
        });
        await expect(page).toHaveURL(/reset-password/);
      });

      await test.step('cleanup test user', async () => {
        await seed.cleanup(`e2e.test.reset.${testRunId}%`);
      });
    });

    test('a signed-in user visiting bare /reset-password still goes to the app', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);
      const testRunId = Date.now();
      const testUser = {
        name: 'E2E Bare Reset User',
        email: `e2e.test.reset.${testRunId}@example.com`,
        password: 'OriginalPassword123!',
      };

      await test.step('create a verified, signed-in user', async () => {
        await seed.signUpViaApi(testUser);
        await seed.verifyEmail(testUser.email);
        await seed.signInUser(testUser.email, testUser.password);
      });

      await test.step('no link means no intent to reset', async () => {
        // The fix is scoped to LINK-carrying requests. A session holder who
        // types the bare URL has shown no recovery intent and still belongs
        // in the app — this pins that the exemption did not widen.
        await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/dashboard|onboarding|billing/, {
          timeout: 30_000,
        });
      });

      await test.step('cleanup test user', async () => {
        await seed.cleanup(`e2e.test.reset.${testRunId}%`);
      });
    });
  });

  test.describe('Navigation', () => {
    test('can navigate from sign-in to forgot password', async ({ page }) => {
      await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: /forgot|reset/i }).click();

      await expect(page).toHaveURL(/forgot-password/);
    });

    test('can navigate back to sign-in from forgot password', async ({
      page,
    }) => {
      await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: /sign in|log in|back/i }).click();

      await expect(page).toHaveURL(/sign-in/);
    });
  });
});
