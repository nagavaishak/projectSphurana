/**
 * Admin terminal: the 2FA gate and impersonation, end to end.
 *
 * This is the layer that would have caught the production incident. The API
 * returned 200 for every impersonate; what broke was the BROWSER's identity —
 * the session cookie swapped to the target while the app kept authenticating
 * with the admin's bearer, so the admin landed back on their own dashboard,
 * saw no banner, and had no way out. Only a real browser shows that.
 *
 * Runs unauthenticated: it seeds the platform admin, signs in as them, and
 * clears the TOTP gate with a live code.
 */
import { createOTP } from '@better-auth/utils/otp';
import { expect, test } from '@playwright/test';
import { SeedHelper } from './fixtures';

// STABLE, not per-run. Playwright workers run in parallel and each seeds in its
// own `beforeAll` against the single fixed platform-admin id, so a per-run email
// meant worker B renamed the account out from under worker A's sign-in. Fixed
// values make every worker's seed idempotent.
const ADMIN_EMAIL = 'e2e.platform.admin@example.com';
const ADMIN_PASSWORD = 'AdminTestPassword123!';

/** A live 6-digit code for the seeded secret, derived the way the server does. */
const totpCode = (secret: string) =>
  createOTP(secret, { digits: 6, period: 30 }).totp();

test.describe('admin terminal', () => {
  test.setTimeout(180_000);

  let totpSecret: string;
  let targetOrgId: string;
  let targetEmail: string;

  test.beforeAll(async ({ request, browser }) => {
    const page = await browser.newPage();
    const seed = new SeedHelper(page, request);
    const admin = await seed.seedPlatformAdmin({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    totpSecret = admin.totpSecret;

    // A PRIVATE org to impersonate into. Depending on whatever orgs happen to
    // be in the shared preview DB is not safe: sibling suites run in parallel
    // and their cleanup reaps organizations, so the admin list can be empty by
    // the time these specs read it (`/admin-terminal/organizations` came back
    // with an empty page mid-run). Seeding our own also lets the assertions
    // name the exact account we expect to become.
    const org = await seed.createEmptyVerifiedOrg('admin-impersonation');
    targetOrgId = org.orgId;
    targetEmail = org.email;

    await page.close();
  });

  /**
   * Sign in and clear the FIRST TOTP gate, landing in the authenticated app.
   *
   * Mirrors the selectors of the proven `src/auth/sign-in.spec.ts` — exact
   * labels, not loose regexes — and asserts the redirect to /verify-2fa so a
   * failure names the URL it actually reached rather than timing out on a
   * locator that was never going to appear.
   */
  const signInAsAdmin = async (page: import('@playwright/test').Page) => {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email', { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    await page.waitForURL(/verify-2fa/, { timeout: 30_000 });
    await page
      .getByLabel('Verification code', { exact: true })
      .fill(await totpCode(totpSecret));
    await page.getByRole('button', { name: /^verify$/i }).click();
    await page.waitForURL((url) => !/verify-2fa|sign-in/.test(url.pathname), {
      timeout: 30_000,
    });
  };

  /** Sign in and clear both gates, leaving the browser inside /admin. */
  const enterAdminTerminal = async (page: import('@playwright/test').Page) => {
    await signInAsAdmin(page);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

    // The admin-terminal gate is a SECOND, separate TOTP prompt.
    const gateHeading = page.getByText(/admin verification/i);
    await gateHeading.waitFor({ timeout: 30_000 });
    await page
      .getByRole('textbox')
      .first()
      .fill(await totpCode(totpSecret));
    await page.getByRole('button', { name: /verify/i }).click();

    await expect(
      page.getByRole('heading', { name: /organi[sz]ations|admin/i }).first()
    ).toBeVisible({ timeout: 30_000 });
  };

  /**
   * Open the org this suite seeded and return the member row for its owner.
   *
   * Navigates by id rather than clicking through the list: the list is shared
   * state that sibling suites can empty, and "the first row" is not an identity
   * — the assertions want a KNOWN account.
   */
  const openSeededMember = async (page: import('@playwright/test').Page) => {
    await page.goto(`/admin/organizations/${targetOrgId}`, {
      waitUntil: 'domcontentloaded',
    });

    const row = page.getByRole('row').filter({ hasText: targetEmail });
    await row.waitFor({ timeout: 30_000 });
    return row;
  };

  const impersonationLauncher = (page: import('@playwright/test').Page) =>
    page.getByRole('button', {
      name: 'Open return to admin panel controls',
    });

  const openImpersonationControls = async (
    page: import('@playwright/test').Page
  ) => {
    const launcher = impersonationLauncher(page);
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    await launcher.click();

    const controls = page.getByRole('dialog', {
      name: 'Admin impersonation controls',
    });
    await expect(controls).toBeVisible();
    return controls;
  };

  const stopImpersonating = async (page: import('@playwright/test').Page) => {
    const controls = await openImpersonationControls(page);
    await controls.getByRole('button', { name: 'Back to admin panel' }).click();
  };

  test('the 2FA gate rejects a wrong code and accepts a real one', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.getByText(/admin verification/i).waitFor({ timeout: 30_000 });

    await test.step('a wrong code is refused, and says so', async () => {
      await page.getByRole('textbox').first().fill('000000');
      await page.getByRole('button', { name: /verify/i }).click();
      // Not asserting the exact copy — only that it reports a failure and
      // does NOT let us through.
      await expect(page.getByText(/invalid|try again|too many/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step('a real code lets us in', async () => {
      await page
        .getByRole('textbox')
        .first()
        .fill(await totpCode(totpSecret));
      await page.getByRole('button', { name: /verify/i }).click();
      await expect(
        page.getByRole('heading', { name: /organi[sz]ations|admin/i }).first()
      ).toBeVisible({ timeout: 30_000 });
    });
  });

  test('impersonating lands on the TARGET user, not the admin', async ({
    page,
  }) => {
    await enterAdminTerminal(page);
    const row = await openSeededMember(page);

    await row.getByRole('button', { name: /^impersonate$/i }).click();
    await page.waitForURL(/dashboard/, {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    });

    // THE regression. The launcher renders off the app's OWN session, so it
    // only appears once the client's identity really switched. Opening it also
    // proves the PiP card names the target rather than the admin.
    const controls = await openImpersonationControls(page);
    await expect(controls).toContainText(targetEmail);
    expect(targetEmail).not.toBe(ADMIN_EMAIL);
  });

  /**
   * The exit must work for a client holding NO cookies.
   *
   * That is not hypothetical: in CI the browser stores no better-auth cookies
   * at all, so `stop-impersonating` 400s and the banner — whose catch is
   * silent — leaves the admin stranded inside the impersonated account.
   * Clearing the jar here reproduces that state deterministically, on any
   * machine, instead of relying on an environment that happens to exhibit it.
   *
   * The app stays authenticated throughout: it carries a bearer token, and the
   * admin_session stash rides in sessionStorage precisely because the
   * impersonate redirect is a full page load.
   */
  test('exits impersonation when the browser holds no cookies', async ({
    page,
  }) => {
    await enterAdminTerminal(page);
    const row = await openSeededMember(page);

    await row.getByRole('button', { name: /^impersonate$/i }).click();
    await page.waitForURL(/dashboard/, {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    });

    await expect(impersonationLauncher(page)).toBeVisible({ timeout: 30_000 });

    // Every cookie gone — session, admin_session, the 2FA gate. Only the
    // bearer and the stash remain, which is CI's shape.
    await page.context().clearCookies();

    await stopImpersonating(page);
    await page.waitForURL(/\/admin/, {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    });
    await expect(impersonationLauncher(page)).toBeHidden({ timeout: 30_000 });
  });

  test('stop impersonating returns to the admin panel, and a SECOND impersonate still works', async ({
    page,
  }) => {
    await enterAdminTerminal(page);
    const first = await openSeededMember(page);

    await first.getByRole('button', { name: /^impersonate$/i }).click();
    await page.waitForURL(/dashboard/, {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    });

    await expect(impersonationLauncher(page)).toBeVisible({ timeout: 30_000 });

    await test.step('exit via the impersonation control', async () => {
      await stopImpersonating(page);
      // The control exits with `window.location.href = '/admin'` — a full page
      // load. `waitForURL` defaults to waitUntil:'load', which waits for ALL
      // network activity to settle and can hang on an authenticated page that
      // keeps fetching; 'domcontentloaded' is the documented choice here.
      await page.waitForURL(/\/admin/, {
        timeout: 60_000,
        waitUntil: 'domcontentloaded',
      });
      await expect(impersonationLauncher(page)).toBeHidden({ timeout: 30_000 });
    });

    // In production this second attempt is exactly what failed: the cookie was
    // already the previous target, so Better Auth refused with "You are not
    // allowed to impersonate users" and the admin had to sign out and back in.
    await test.step('impersonate again without re-signing-in', async () => {
      const again = await openSeededMember(page);
      await again.getByRole('button', { name: /^impersonate$/i }).click();
      await page.waitForURL(/dashboard/, {
        timeout: 60_000,
        waitUntil: 'domcontentloaded',
      });
      const controls = await openImpersonationControls(page);
      await expect(controls).toContainText(targetEmail);
    });
  });
});
