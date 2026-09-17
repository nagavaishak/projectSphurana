import { expect, test } from '@playwright/test';
import { API_URL, SeedHelper, TEST_DATA } from '../fixtures/index.js';

const TEST_RUN_ID = Date.now();

/**
 * apps/app doesn't auto-select an active organization on sign-in (apps/web's
 * SSR layout did this). Set one explicitly after every signInUser before
 * hitting org-scoped APIs.
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
 * Practitioner Booking Journey E2E Tests
 *
 * 1. Adding practitioners during onboarding (Step 5 in the apps/app wizard)
 * 2. Assigning services to practitioners (API)
 * 3. Public booking with practitioner selection
 * 4. Permission enforcement for practitioner CRUD (API)
 */

test.describe('Practitioner Booking Journey', () => {
  test.setTimeout(180_000); // 3 minutes for long journeys

  /**
   * The old "add a practitioner on the Add Your Team step" test drove the
   * LEGACY multi-step onboarding wizard. That wizard is gone — /onboarding now
   * redirects to the Claire deck at /welcome, which has no team step — so the
   * step it asserted against no longer ships.
   *
   * Adding a team member through the real UI is covered end to end by
   * src/team/add-team-member.spec.ts (owner adds a member → the invited user
   * accepts → wizard → dashboard).
   */

  test.describe('Service-Practitioner Assignment', () => {
    test('can assign services to a practitioner via API', async ({
      page,
      request,
    }) => {
      const seed = new SeedHelper(page, request);

      await seed.signInUser(
        TEST_DATA.bareUser.email,
        TEST_DATA.bareUser.password
      );
      await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
      await ensureActiveOrg(seed);

      const service = await seed.createService({
        name: `E2E Assign Service ${TEST_RUN_ID}`,
        category: 'treatment',
        appointmentDuration: 30,
      });

      const practitioner = (await seed.authenticatedApiCall(
        'POST',
        '/practitioners',
        {
          name: `E2E Assign Practitioner ${TEST_RUN_ID}`,
          email: `e2e.assign.${TEST_RUN_ID}@example.com`,
        }
      )) as { id: string };

      await seed.authenticatedApiCall(
        'PUT',
        `/practitioners/${practitioner.id}/services`,
        { serviceIds: [service.id] }
      );

      const practitionerData = (await seed.authenticatedApiCall(
        'GET',
        `/practitioners/${practitioner.id}`
      )) as { services?: Array<{ serviceId: string }> };

      expect(practitionerData.services).toBeDefined();
      expect(practitionerData.services?.length).toBeGreaterThanOrEqual(1);
      expect(
        practitionerData.services?.some((s) => s.serviceId === service.id)
      ).toBeTruthy();
    });
  });

  // The 'Public Booking Form' section MOVED to
  // apps/marketing-astro-e2e/src/booking/public-booking.spec.ts — the booking
  // wizard left this app for marketing-astro, so it drove a route that no
  // longer exists here. Its claim (a practitioner-assigned service is listed
  // as bookable) is asserted there, anonymously.

  test.describe('Permission Enforcement', () => {
    /**
     * `POST /practitioners` is `@RequireRole('owner')` (RoleGuard). This used to
     * be `expect(true).toBe(true)` behind a "the test env can't provision a
     * non-owner" comment — it can: the owner's composite
     * `POST /practitioners/team-member` returns the invitation whose id IS the
     * accept token (see src/team/add-team-member.spec.ts), and
     * `POST /organizations/invitations/:id/accept` joins the invited user to the
     * org with the invited role (`permissionLevel: 'low'` → org role `member`).
     * So we provision a real non-owner and assert the real 403.
     */
    test('returns 403 when non-owner tries to create practitioner', async ({
      page,
      request,
      browser,
    }) => {
      const seed = new SeedHelper(page, request);

      await seed.signInUser(
        TEST_DATA.bareUser.email,
        TEST_DATA.bareUser.password
      );
      await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
      await ensureActiveOrg(seed);

      const orgId = await seed.getActiveOrganizationId();
      expect(orgId, 'owner has no active organization').toBeTruthy();

      const memberEmail = `e2e.test.nonowner.${TEST_RUN_ID}@example.com`;
      const memberPassword = 'TestPassword123!';

      // Owner invites a LOW-permission team member → org role `member`.
      const created = (await seed.authenticatedApiCall(
        'POST',
        '/practitioners/team-member',
        {
          firstName: 'E2E',
          lastName: `NonOwner ${TEST_RUN_ID}`,
          email: memberEmail,
          permissionLevel: 'low',
        }
      )) as {
        practitioner?: { id?: string };
        invitation?: { id?: string };
      };

      const invitationId = created.invitation?.id;
      const practitionerId = created.practitioner?.id;
      expect(
        invitationId,
        `team-member create returned no invitation: ${JSON.stringify(created)}`
      ).toBeTruthy();

      // The invited person: own browser context, own session.
      const memberContext = await browser.newContext({
        baseURL: process.env.BASE_URL || 'http://localhost:5173',
      });
      const memberPage = await memberContext.newPage();
      try {
        const memberSeed = new SeedHelper(memberPage, request);

        await memberSeed.signUpViaApi({
          name: `E2E NonOwner ${TEST_RUN_ID}`,
          email: memberEmail,
          password: memberPassword,
        });
        await memberSeed.verifyEmail(memberEmail);
        await memberSeed.signInUser(memberEmail, memberPassword);

        // Accept the invite → the user is now a `member` of the owner's org.
        await memberSeed.authenticatedApiCall(
          'POST',
          `/organizations/invitations/${invitationId}/accept`,
          { acceptedTerms: true }
        );
        await memberSeed.authenticatedApiCall('POST', '/organization/active', {
          organizationId: orgId,
        });

        // Sanity: the member really is in the owner's org (otherwise a 403 below
        // would prove nothing — an outsider gets 403 for the wrong reason).
        const memberOrgId = await memberSeed.getActiveOrganizationId();
        expect(memberOrgId, 'invited member did not join the owner org').toBe(
          orgId
        );

        // The actual subject: a non-owner member is forbidden from creating a
        // practitioner. (`authenticatedApiCall` swallows the status code, so go
        // through page.request — same cookie jar — to read it.)
        const response = await memberPage.request.post(
          `${API_URL}/practitioners`,
          {
            data: {
              name: `E2E Forbidden ${TEST_RUN_ID}`,
              email: `e2e.test.forbidden.${TEST_RUN_ID}@example.com`,
            },
          }
        );
        const body = await response.text();
        expect(
          response.status(),
          `non-owner POST /practitioners should be 403, got ${response.status()}: ${body}`
        ).toBe(403);
      } finally {
        await memberContext.close();
      }

      // Clean up the practitioner row the invite created.
      await seed.authenticatedApiCall(
        'DELETE',
        `/practitioners/${practitionerId}`,
        undefined,
        [404]
      );
    });

    test('allows owner to manage practitioners', async ({ page, request }) => {
      const seed = new SeedHelper(page, request);

      await seed.signInUser(
        TEST_DATA.bareUser.email,
        TEST_DATA.bareUser.password
      );
      await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
      await ensureActiveOrg(seed);

      const practitioner = (await seed.authenticatedApiCall(
        'POST',
        '/practitioners',
        {
          name: `E2E Owner Create ${TEST_RUN_ID}`,
          email: `e2e.owner.create.${TEST_RUN_ID}@example.com`,
        }
      )) as { id: string; name: string };

      expect(practitioner.id).toBeDefined();
      expect(practitioner.name).toBe(`E2E Owner Create ${TEST_RUN_ID}`);

      const updated = (await seed.authenticatedApiCall(
        'PUT',
        `/practitioners/${practitioner.id}`,
        { title: 'Lead Therapist' }
      )) as { title: string };

      expect(updated.title).toBe('Lead Therapist');

      const deleted = (await seed.authenticatedApiCall(
        'DELETE',
        `/practitioners/${practitioner.id}`
      )) as { success: boolean };

      expect(deleted.success).toBe(true);
    });
  });
});
