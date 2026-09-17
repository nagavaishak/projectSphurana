import { expect, test } from '@playwright/test';
import { API_URL, SeedHelper } from '../fixtures/index.js';

const TEST_RUN_ID = Date.now();

/**
 * Onboarding Journey E2E Test
 *
 * Tests the complete onboarding flow for a new user:
 * Sign up → Verify email → Sign in → Complete onboarding → Billing → Dashboard
 *
 * apps/app on main renders the multi-step onboarding wizard (NOT the funnel
 * brand-analysis flow). See apps/app/src/features/onboarding/onboarding/
 * onboarding-form.tsx for the step list.
 *
 * Runs WITHOUT stored auth state (journey-tests project).
 */
test.describe('Onboarding Journey', () => {
  test.setTimeout(300_000); // 5 minutes

  const uniqueEmail = `e2e.test.onboarding.${TEST_RUN_ID}@example.com`;
  const password = 'TestPassword123!';
  const businessName = `E2E Onboarding Salon ${TEST_RUN_ID}`;

  test.afterAll(async ({ request }) => {
    const response = await request.post(`${API_URL}/testing/cleanup`, {
      headers: { Authorization: `Bearer ${process.env.E2E_SEED_TOKEN}` },
      data: { pattern: 'e2e.test.onboarding.%' },
    });
    const data = await response.json();
    if (!data.success) {
      console.warn(`[Onboarding] Cleanup warning: ${data.message}`);
    }
  });

  test('complete onboarding from signup to dashboard', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    // ─── Create user and sign in ─────────────────────────
    await test.step('Create user via API, verify email, and sign in', async () => {
      await seed.signUpViaApi({
        name: 'E2E Onboarding User',
        email: uniqueEmail,
        password,
      });

      // Verify email via testing API token (redirects post-verify)
      await seed.verifyEmail(uniqueEmail);

      // Sign in via UI to set the session cookie
      await seed.signInUser(uniqueEmail, password);

      // Should land on onboarding (no org yet)
      await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });
    });

    // ─── Step 1: Business name ────────────────────────────
    await test.step('Step 1: Business name', async () => {
      // Wait through the OnboardingForm "Loading..." state — session + org
      // list both have to resolve before the wizard mounts.
      await expect(page.getByText("What's your business called?")).toBeVisible({
        timeout: 30000,
      });

      await page.getByLabel(/business name/i).fill(businessName);
      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 2: Business type ────────────────────────────
    await test.step('Step 2: Business type', async () => {
      await expect(
        page.getByText('What type of business do you run?')
      ).toBeVisible();

      // Open the popover (trigger is labelled by FieldLabel)
      await page.getByLabel(/business type/i).click();

      // The search input only mounts once the popover has opened.
      const searchInput = page.getByPlaceholder(/search business type/i);
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Salon');

      // Wait for the command list to render a matching option rather than
      // guessing at how long the filter takes.
      const salonOption = page.getByRole('option', { name: /salon/i }).first();
      await expect(salonOption).toBeVisible();
      await salonOption.click();

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 3: Website analysis — skip ─────────────────
    await test.step('Step 3: Skip website analysis', async () => {
      await expect(page.getByText('Enter your website')).toBeVisible();

      // Leave URL empty and continue
      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 4: Locations ───────────────────────────────
    await test.step('Step 4: Add a location', async () => {
      await expect(page.getByText('Your Locations')).toBeVisible();

      await page.getByRole('button', { name: /add a location/i }).click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: 'visible', timeout: 5000 });

      // Switch to manual entry (avoids Google Places dependency)
      await dialog.getByText(/enter address manually/i).click();

      await dialog
        .getByPlaceholder('Street address *')
        .waitFor({ timeout: 5000 });

      await dialog.getByPlaceholder('Street address *').fill('123 Test Street');
      await dialog.getByPlaceholder('City *').fill('Dublin');

      // Select country — the search input only mounts once the country
      // popover is open.
      await dialog.getByRole('button', { name: /country/i }).click();
      const countrySearch = page.getByPlaceholder(/search country/i);
      await expect(countrySearch).toBeVisible();
      await countrySearch.fill('Ireland');

      // Wait for the filtered option to render instead of guessing.
      const irelandOption = page
        .getByRole('option', { name: /ireland/i })
        .first();
      await expect(irelandOption).toBeVisible();
      await irelandOption.click();

      await dialog.getByRole('button', { name: /^add location$/i }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 5000 });

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 5: Practitioners ────────────────────────────
    await test.step('Step 5: Add Your Team', async () => {
      await expect(page.getByText('Add Your Team')).toBeVisible();

      // Signed-in user is pre-populated as a team member — just continue.
      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 6: Booking system ──────────────────────────
    await test.step('Step 6: Booking system', async () => {
      await expect(page.getByText('How do you handle bookings?')).toBeVisible();

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 7: Opening hours ───────────────────────────
    await test.step('Step 7: Opening hours', async () => {
      await expect(page.getByText('Set your opening hours')).toBeVisible();

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 8: Credibility line (triggers org creation) ─
    await test.step('Step 8: Credibility line', async () => {
      await expect(
        page.getByText('Choose one credibility line to use in your ads')
      ).toBeVisible();

      const firstRadio = page.locator('#credibility-0');
      await firstRadio.click();

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ─── Step 9: Owner provides services (submits INTO THE PRODUCT) ─────
    await test.step('Step 9: Owner provides services', async () => {
      // Credibility step's onBeforeContinue creates the org — can take 10+s
      await expect(page.getByText('One last thing')).toBeVisible({
        timeout: 30000,
      });

      await page.getByRole('button', { name: /complete setup/i }).click();

      // Onboarding no longer ends on a plan picker. Customers arrive having
      // already bought on a sales call, so finishing the wizard lands them in
      // the product — /setup-profile when the owner provides services (this
      // journey's path), /dashboard/home otherwise. Landing back on /billing
      // would mean asking them to buy what they already own.
      await expect(page).toHaveURL(/setup-profile|dashboard/, {
        timeout: 30000,
      });
      await expect(page).not.toHaveURL(/\/billing/);
    });

    // ─── Attach the subscription an operator would have seeded ──────────
    await test.step('Attach subscription and reach the dashboard', async () => {
      // Prefer the DB-backed lookup over the session value — when org
      // creation races with the navigation away from onboarding, the session
      // can temporarily report an activeOrganizationId pointing at a row
      // that's not yet flushed.
      const orgId =
        (await seed.getOrganizationByEmail(uniqueEmail)) ??
        (await seed.getActiveOrganizationId());
      expect(orgId).toBeTruthy();

      // Stands in for the onboarding specialist pasting the sub_ id: on this
      // path the subscription is bought outside the product, so nothing in
      // the wizard creates one.
      await seed.forceCreateSubscription(orgId as string);

      // gotoDashboardPage handles the auth-redirect retry loop + sidebar wait
      await seed.gotoDashboardPage('/dashboard/home');
    });
  });
});
