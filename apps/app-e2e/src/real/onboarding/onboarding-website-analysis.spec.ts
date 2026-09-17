import { expect, test } from '@playwright/test';
import {
  API_URL,
  SeedHelper,
  TEST_ASSETS_BASE_URL,
  fillEmptyTeamEmails,
} from '../../fixtures/index.js';

const TEST_RUN_ID = Date.now();

/**
 * Onboarding Journey — Website Analysis Variant
 *
 * Same flow as onboarding.spec.ts but submits a website URL on Step 3 instead
 * of skipping. Exercises the website analysis API
 * (POST /website-analysis/analyze) end to end — a real crawl, a real merged
 * scraping pass and a real AI classification — and asserts the services it
 * discovered were created on the org.
 *
 * WHY THIS LIVES IN `src/real/` AND NOT THE PR GATE
 * ------------------------------------------------
 * A run of this spec is billed work: with FIRECRAWL_API_KEY /
 * BROWSERBASE_API_KEY / BROWSER_USE_API_KEY / OPENAI_API_KEY all set, one
 * pass fans out across every scraping strategy plus a GPT extraction. That is
 * the same economics as the Gemini / Remotion renders the `real-e2e` project
 * already exists to contain ("no retries: every attempt is a real billed
 * render"), so it belongs beside them — nightly, single-worker, no retries —
 * rather than on every push. It was previously `@quarantine`d off the gate
 * for its cost and latency; this makes that placement permanent and honest
 * instead of a loan against the gate's trust.
 *
 * WHY THE URL IS OURS
 * -------------------
 * It used to point at a real third-party clinic (baysidebeautyclinic.com).
 * That crawled a stranger's server from our CI, spent money classifying
 * content we do not control, and made the "services were created" assertion
 * hostage to someone else's redesign. `clinic-fixture.html` is a committed
 * fixture (src/fixtures/assets/) that
 * `scripts/ensure-e2e-test-assets.sh` publishes to the public E2E prefix, so
 * it is publicly crawlable — Firecrawl and Browserbase fetch it from their
 * own servers, which a localhost fixture could never satisfy — while staying
 * versioned in this repo.
 *
 * Timeout 6 min: the fixture is a small static page, so the crawl is quick
 * and the AI classification (~30s) plus the remaining wizard (~60–90s) is the
 * bulk of it. `real-e2e` sets retries: 0, so this budget is the whole story —
 * the old 10 min existed to absorb a slow third-party site that is now gone.
 *
 * Runs WITHOUT stored auth state: it signs its own user up. The `real-e2e`
 * project supplies the bare-org storageState for the render specs, so this
 * file opts out.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Onboarding Journey — Website Analysis', () => {
  test.setTimeout(360_000); // 6 minutes

  const uniqueEmail = `e2e.test.onboarding-wa.${TEST_RUN_ID}@example.com`;
  const password = 'TestPassword123!';
  const businessName = `E2E Website Analysis Salon ${TEST_RUN_ID}`;

  // Our own committed fixture clinic site — services with prices, a team, hours
  // and a Dublin address, so the analyzer has structured data to extract and
  // the "services were created" assertion below is deterministic.
  //
  // `?run=` is a CACHE BUSTER, and it is load-bearing. analyze-website caches
  // its whole result in Redis under the URL string for 24 hours, so a fixed
  // URL would let this spec go green by reading yesterday's JSON without
  // crawling, scraping or classifying anything — which is precisely how the
  // original failed twice at 2.1m and then "passed" in 18.9s on retry #2. A
  // per-run URL forces a cache miss, so a nightly green means the pipeline
  // actually ran. S3 ignores the unknown query param and serves the object.
  const websiteUrl = `${TEST_ASSETS_BASE_URL}/clinic-fixture.html?run=${TEST_RUN_ID}`;

  test.afterAll(async ({ request }) => {
    const response = await request.post(`${API_URL}/testing/cleanup`, {
      headers: { Authorization: `Bearer ${process.env.E2E_SEED_TOKEN}` },
      data: { pattern: 'e2e.test.onboarding-wa.%' },
    });
    const data = await response.json();
    if (!data.success) {
      console.warn(`[Onboarding WA] Cleanup warning: ${data.message}`);
    }
  });

  // De-quarantined by relocation, not by a tag removal alone: the flake this
  // spec was quarantined for (run 32512997587 — two 2.1m failures, then green
  // in 18.9s on retry #2, i.e. only once the analysis was cached) was the
  // third-party crawl's latency, and both halves of it are gone. It no longer
  // shares a budget with the bare suite, and it no longer waits on a site we
  // do not control.
  test('complete onboarding with website analysis', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    await test.step('Create user via API, verify email, and sign in', async () => {
      await seed.signUpViaApi({
        name: 'E2E Website Analysis User',
        email: uniqueEmail,
        password,
      });
      await seed.verifyEmail(uniqueEmail);
      await seed.signInUser(uniqueEmail, password);
      await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });
    });

    await test.step('Step 1: Business name', async () => {
      await expect(page.getByText("What's your business called?")).toBeVisible({
        timeout: 30000,
      });

      await page.getByLabel(/business name/i).fill(businessName);
      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 2: Business type', async () => {
      await expect(
        page.getByText('What type of business do you run?')
      ).toBeVisible();

      await page.getByLabel(/business type/i).click();

      // The search input only mounts once the popover has opened.
      const searchInput = page.getByPlaceholder(/search business type/i);
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Salon');

      // Wait for the command list to render a matching option.
      const salonOption = page.getByRole('option', { name: /salon/i }).first();
      await expect(salonOption).toBeVisible();
      await salonOption.click();

      await page.getByRole('button', { name: /continue/i }).click();
    });

    // ── THE DIFFERENCE: submit a real website URL ───────
    await test.step('Step 3: Submit website URL and wait for analysis', async () => {
      await expect(page.getByText('Enter your website')).toBeVisible();

      await page
        .getByLabel(/website/i)
        .first()
        .fill(websiteUrl);

      // Continue triggers POST /website-analysis/analyze — can take 30-60s.
      await page.getByRole('button', { name: /continue/i }).click();

      // The wizard advances to the next step (locations) when analysis
      // finishes. The strict assertion on what was discovered is at the end of
      // the spec ("Services discovered by the analyzer were created"); here we
      // only confirm the call didn't hang and the funnel advanced.
      await expect(page.getByText('Your Locations')).toBeVisible({
        timeout: 120000,
      });
    });

    await test.step('Step 4: Add a location', async () => {
      // Website analysis may or may not have discovered an address, so the
      // step renders either the empty state ("Add a location") or a list of
      // discovered rows ("Add another location"). Both open the SAME dialog,
      // so add one deterministically rather than branching on what the
      // analyzer happened to find.
      await page
        .getByRole('button', { name: /add (a|another) location/i })
        .click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: 'visible', timeout: 5000 });

      await dialog.getByText(/enter address manually/i).click();
      await dialog
        .getByPlaceholder('Street address *')
        .waitFor({ timeout: 5000 });

      await dialog.getByPlaceholder('Street address *').fill('123 Test Street');
      await dialog.getByPlaceholder('City *').fill('Dublin');

      // The country search input only mounts once the popover is open.
      await dialog.getByRole('button', { name: /country/i }).click();
      const countrySearch = page.getByPlaceholder(/search country/i);
      await expect(countrySearch).toBeVisible();
      await countrySearch.fill('Ireland');

      // Wait for the filtered option to render.
      const irelandOption = page
        .getByRole('option', { name: /ireland/i })
        .first();
      await expect(irelandOption).toBeVisible();
      await irelandOption.click();

      await dialog.getByRole('button', { name: /^add location$/i }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 5000 });

      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 5: Add Your Team', async () => {
      await expect(page.getByText('Add Your Team')).toBeVisible();
      // Website analysis may discover practitioners without an email. Each such
      // row exposes a required inline email input — fill them so the step
      // validates (email is mandatory for every team member).
      // The row list is NOT stable while you work on it: the analyzer's
      // practitioners hydrate after the step mounts, and filling one row can
      // itself re-render the list (the owner row de-duplicates). Any index
      // captured beforehand is stale by the time it is typed into — which is
      // how this failed, with `fill` waiting forever on a `nth(1)` that had
      // gone. `locator.all()` does not help: it returns POSITIONAL locators
      // that re-resolve at fill time and race identically.
      //
      // The helper re-queries every pass and fills the first still-empty
      // input, so it converges on whatever is actually on screen.
      const filled = await fillEmptyTeamEmails(
        page,
        (i) => `e2e.team.${i}@example.com`
      );
      console.log(`[onboarding-wa] filled ${filled} team email input(s)`);

      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 6: Booking system', async () => {
      await expect(page.getByText('How do you handle bookings?')).toBeVisible();
      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 7: Opening hours', async () => {
      await expect(page.getByText('Set your opening hours')).toBeVisible();
      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 8: Credibility line', async () => {
      await expect(
        page.getByText('Choose one credibility line to use in your ads')
      ).toBeVisible();

      const firstRadio = page.locator('#credibility-0');
      await firstRadio.click();

      // Continue triggers org creation — can take 10+ seconds (the next step
      // waits for "One last thing" with a 30s budget).
      await page.getByRole('button', { name: /continue/i }).click();
    });

    await test.step('Step 9: Owner provides services', async () => {
      await expect(page.getByText('One last thing')).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole('button', { name: /complete setup/i }).click();
      await expect(page).toHaveURL(/billing/, { timeout: 30000 });
    });

    await test.step('Services discovered by the analyzer were created', async () => {
      // The per-service detail funnel at /setup-services is gone; onboarding
      // now creates services directly from the analyzer's list during org
      // creation. That list is the SUBJECT of this spec, so assert it landed
      // rather than dropping the check along with the funnel.
      const orgs = (await seed.authenticatedApiCall(
        'GET',
        '/organizations'
      )) as { organizations?: Array<{ id: string }> };
      const firstOrgId = orgs.organizations?.[0]?.id;
      expect(firstOrgId).toBeTruthy();
      await seed.authenticatedApiCall('POST', '/organization/active', {
        organizationId: firstOrgId as string,
      });

      const listed = (await seed.authenticatedApiCall(
        'GET',
        '/organization-services?isActive=true&limit=100'
      )) as { items?: Array<{ name: string }> };
      expect((listed.items ?? []).length).toBeGreaterThan(0);
    });

    await test.step('Bypass billing and access dashboard', async () => {
      const orgId =
        (await seed.getOrganizationByEmail(uniqueEmail)) ??
        (await seed.getActiveOrganizationId());
      expect(orgId).toBeTruthy();

      await seed.forceCreateSubscription(orgId as string);

      await seed.gotoDashboardPage('/dashboard/home');
    });
  });
});
