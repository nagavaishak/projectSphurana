import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

/**
 * apps/app doesn't auto-select an active organization on sign-in (apps/web's
 * SSR layout did this). When a fresh session lands on /dashboard the
 * `activeOrganizationId` is still null, so any controller using
 * `@ActiveOrganization()` returns 400. Call this after every signInUser in a
 * journey test that hits org-scoped APIs.
 */
async function ensureActiveOrg(seed: SeedHelper): Promise<void> {
  const orgs = (await seed.authenticatedApiCall('GET', '/organizations')) as {
    organizations?: Array<{ id: string }>;
  };
  const firstOrgId = orgs.organizations?.[0]?.id;
  if (firstOrgId) {
    await seed.authenticatedApiCall('POST', '/organization/active', {
      organizationId: firstOrgId,
    });
  }
}

/**
 * User Journey E2E Tests
 *
 * These tests validate complete user workflows across multiple pages
 * and features using REAL API calls (no mocks).
 *
 * Journeys tested:
 * 1. Dashboard Navigation Journey (navigate all main sections)
 *
 * NOTE: These tests run in the "journey-tests" project (serial, no stored auth).
 * Onboarding is tested separately in onboarding.spec.ts.
 */

test.describe('User Journeys', () => {
  test.setTimeout(300_000); // 5 minutes for complex journeys

  /**
   * The old "Appointment Booking Journey" (create lead → open the calendar's
   * "Add Appointment" dialog → pick a lead → type a title) is GONE, not
   * dropped: the Fresha calendar books a CLIENT against a SERVICE, so that
   * dialog (lead picker + free-text title) no longer exists in the product.
   *
   * Its replacement is stronger and lives in
   * src/calendar/calendar-booking-flows.spec.ts — it seeds a service +
   * practitioner + client, books through the real "Add → Appointment" dialog
   * (and the mobile create form), then asserts the appointment persisted AND
   * renders on the agenda. Re-adding a lead-based variant here would only
   * assert against UI that no longer ships.
   */

  test.describe('Dashboard Navigation Journey', () => {
    test('navigate through all main dashboard sections', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);

      // Sign in with existing test user
      await test.step('Sign in', async () => {
        await seed.signInUser(
          TEST_DATA.bareUser.email,
          TEST_DATA.bareUser.password
        );
        await expect(page).toHaveURL(/dashboard|billing/, { timeout: 30000 });
        await ensureActiveOrg(seed);
      });

      // Navigate to the unified Clients surface (was /dashboard/lead-management).
      await test.step('Navigate to Clients', async () => {
        await seed.gotoDashboardPage('/dashboard/customers');
        // The page has no visible heading; it ships the clients table with
        // stage tabs. Anchor on the Add Customer button, which only exists on
        // this route.
        await expect(
          page.getByRole('button', { name: /add customer/i })
        ).toBeVisible({ timeout: 10000 });
      });

      // Navigate to the Calendar (appointments live here since the Fresha nav;
      // /dashboard/appointments is now only a redirect to /dashboard/calendar).
      await test.step('Navigate to Calendar', async () => {
        await seed.gotoDashboardPage('/dashboard/calendar');
        await expect(page).toHaveURL(
          /calendar(\/(month|day|three-day|week|year|agenda))?/,
          { timeout: 10000 }
        );
        // The calendar header's "Add" split-button (Appointment / Blocked time /
        // Sale / Quick payment) — see components/calendar/.../add-menu.tsx.
        await expect(
          page.getByRole('button', { name: 'Add', exact: true })
        ).toBeVisible({ timeout: 10000 });
      });

      // Navigate to Socials (the content calendar moved under Marketing)
      await test.step('Navigate to Socials', async () => {
        await seed.gotoDashboardPage('/dashboard/marketing/socials');
        await expect(page).toHaveURL(/marketing\/socials/, { timeout: 10000 });
      });

      // Navigate to Advertising
      await test.step('Navigate to Advertising', async () => {
        await seed.gotoDashboardPage('/dashboard/marketing/advertising');
        await expect(page).toHaveURL(/marketing\/advertising/);

        // The advertising layout renders exactly ONE of two states: the
        // "Connect Meta Ads" empty state (no Meta integration) or the campaign
        // list with its "New Campaign" action. Both anchors exist ONLY on this
        // route.
        //
        // The old check was `hasCampaigns || hasConnectState`, where
        // hasCampaigns matched /campaigns|advertising/i ANYWHERE on the page —
        // the sidebar always contains it, so it could not fail on any page in
        // the app.
        const connectMeta = page.getByRole('button', {
          name: 'Connect Meta Ads',
        });
        const newCampaign = page.getByRole('button', { name: /new campaign/i });
        await expect(connectMeta.or(newCampaign).first()).toBeVisible({
          timeout: 15_000,
        });
      });
    });
  });
});
