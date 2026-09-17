import type { BrowserContext, Page } from '@playwright/test';
import {
  addTeamMemberButton,
  entityEditorNav,
  entityEditorSave,
} from '../fixtures/app.js';

import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';
import { SeedHelper } from '../fixtures/seed.fixture.js';

/**
 * Phase 7 E2E — Add-team-member + invited-member journey (docs/plans/
 * add-team-member-impl.md §7). One flow, two actors, real API (no mocking):
 *
 *   Owner opens "Add team member" (full-page editor on dashboard/team/members)
 *   → fills Profile + selects a Service + a Location + sets the Medium
 *   permission role + an hourly wage → Add → the composite
 *   `POST /practitioners/team-member` creates the practitioner + invitation.
 *
 *   In a FRESH unauthenticated context, the invited person opens the public
 *   `/accept-invitation?token=<invitationId>` link → Join (email prefilled) →
 *   Review-and-confirm (prefilled first/last/country + terms) → Password →
 *   Accept → the skippable self-onboarding wizard → lands in the dashboard.
 *
 * Token acquisition: NO new testing endpoint was needed. The composite create
 * endpoint returns `{ practitioner, invitation }` (see createTeamMember service
 * / InviteMemberResponse), and the accept route treats the invitation id AS the
 * opaque token (`/accept-invitation?token=<invitationId>`). We capture the
 * create response over the wire and read `invitation.id` straight from it.
 *
 * Scope: desktop-only. The owner editor is a multi-section left-nav surface; on
 * a phone the nav is a drill-down list (nav and panel never co-render), which
 * makes cross-section scripting brittle and viewport-specific. The native
 * accept + wizard happy path is covered by the Maestro lane (plan §7.2), so we
 * skip this heavy two-context flow on the `tabs-mobile` project.
 */
/**
 * The skippable self-onboarding wizard's steps, in `STEP_ORDER`, each keyed by
 * its own <h1> (team-member-wizard/steps/*). Waiting for the next heading is the
 * real "the step advanced" condition.
 */
const WIZARD_STEP_HEADINGS = [
  'Add a profile photo', // photo-tips
  'Upload your photo', // photo-upload
  'Create your profile', // headline-bio
  'Languages you speak', // languages
  'Add your social links', // social
];

test.describe('Team · add team member + invite accept', () => {
  test('owner adds a member → invited user accepts → wizard → dashboard', async ({
    org,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes('mobile'),
      'Desktop-only: multi-section editor + two-context accept flow. Mobile is covered by the Maestro native lane.'
    );
    // Two-context journey with a full sign-up + accept + wizard walk is well
    // over the 60s default.
    test.setTimeout(180_000);

    const { page, seed, orgId } = org;
    const stamp = Date.now();
    const firstName = 'E2E';
    const lastName = `Member ${stamp}`;
    const memberName = `${firstName} ${lastName}`;
    // `e2e.test.*` so global-teardown's cleanup (pattern `e2e.test.%`) reaps the
    // invited user + membership created by the accept flow. (The plan's
    // `e2e.member.*` example wouldn't match that pattern and would linger.)
    const memberEmail = `e2e.test.member.${stamp}@example.com`;
    const memberPassword = 'TestPassword123!';

    // ── Prerequisites: the empty per-test org has no services/locations, but
    // the editor's Services/Locations panels render an empty state without
    // them. Seed one of each through the real authenticated API.
    const serviceName = `E2E Service ${stamp}`;
    const locationName = `E2E Location ${stamp}`;
    await test.step('seed a service and a location', async () => {
      await seed.createService({ name: serviceName });
      // `country` is the LOWERCASE ISO code — `countryCodeValues` is keyed
      // `ie`, not `IE`. Sending 'IE' failed createLocationSchema and the seed
      // 400'd ("Invalid input"), so the location never existed and the editor's
      // Locations panel had no checkbox to tick. The seed error was logged and
      // swallowed, so the test failed later, on a missing checkbox, far from the
      // actual cause.
      await seed.authenticatedApiCall('POST', '/organization-locations', {
        name: locationName,
        addressLine1: '123 Test Street',
        city: 'Dublin',
        country: 'ie',
        isPrimary: true,
      });
    });

    // ── Owner: open the full-page "Add team member" editor.
    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    // Confirm the authenticated surface mounted (the roster's primary action
    // renders regardless of data), then open the editor.
    await addTeamMemberButton(page).click({ timeout: 30_000 });
    await expect(
      page.getByRole('heading', { name: 'Add team member' })
    ).toBeVisible({ timeout: 15_000 });

    // The editor is a fixed overlay whose left-nav section names ("Services",
    // "Locations", "Settings") collide with the app sidebar behind it, so nav
    // clicks are scoped to the editor's own nav.
    const editorNav = entityEditorNav(page);

    await test.step('fill the Profile panel', async () => {
      // Profile is the default active section.
      await page.getByLabel('First name').fill(firstName);
      await page.getByLabel('Last name').fill(lastName);
      await page.getByLabel('Email').fill(memberEmail);
      await page.getByLabel('Phone', { exact: true }).fill('5551234567');
    });

    await test.step('select a service', async () => {
      await editorNav.getByRole('button', { name: 'Services' }).click();
      await page
        .getByRole('checkbox', { name: serviceName })
        .click({ timeout: 15_000 });
    });

    await test.step('select every location', async () => {
      await editorNav.getByRole('button', { name: 'Locations' }).click();
      // EVERY branch, not just the seeded one.
      //
      // The org already has a branch from provisioning, and this test seeds a
      // second — so ticking only the seeded one assigns the member to branch B
      // while the roster below is viewed at whichever branch resolved, and
      // branch scoping then correctly hides them. Worse, the seed passes
      // `isPrimary: true` without unsetting the existing primary, so the org
      // holds TWO primaries and `resolveDefaultLocation` (no stable tiebreak)
      // picks arbitrarily — which is what made this flaky rather than
      // consistently red.
      //
      // `check()` rather than `click()`: idempotent, so an already-ticked box
      // is a no-op and this needs no conditional.
      const boxes = page
        .locator('[data-locations-panel]')
        .getByRole('checkbox');
      await expect(boxes.first()).toBeVisible({ timeout: 15_000 });
      for (const box of await boxes.all()) {
        await box.check();
      }
    });

    await test.step('set the permission role to Medium', async () => {
      await editorNav.getByRole('button', { name: 'Settings' }).click();
      await page.getByLabel('Permission role').click();
      await page.getByRole('option', { name: 'Medium' }).click();
    });

    await test.step('set an hourly wage', async () => {
      await editorNav
        .getByRole('button', { name: 'Wages and timesheets' })
        .click();
      await page.getByLabel('Compensation').click();
      await page.getByRole('option', { name: /hourly/i }).click();
      await page.getByLabel('Hourly rate').fill('20');
    });

    // ── Submit. Capture the composite create response over the wire — it
    // carries both the practitioner (for cleanup) and the invitation (whose id
    // is the accept token).
    let invitationId = '';
    let practitionerId = '';
    await test.step('click Add and capture the invitation token', async () => {
      const responsePromise = page.waitForResponse(
        (res) =>
          res.url().includes('/practitioners/team-member') &&
          res.request().method() === 'POST',
        { timeout: 30_000 }
      );
      // The unified entity editor owns the action and labels it "Save" (it was
      // "Add" before §6 folded every create/edit surface into one chrome). Page
      // level, not `content()`: the editor is a FIXED OVERLAY outside the inset.
      await entityEditorSave(page).click();
      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as {
        practitioner?: { id?: string };
        invitation?: { id?: string; email?: string };
      };
      invitationId = body.invitation?.id ?? '';
      practitionerId = body.practitioner?.id ?? '';
      expect(
        invitationId,
        'composite create returned an invitation id'
      ).toBeTruthy();
      expect(
        practitionerId,
        'composite create returned a practitioner id'
      ).toBeTruthy();
      expect(body.invitation?.email).toBe(memberEmail);
    });

    // Success surfaces as a toast + the new member persisting into the roster.
    await expect(page.getByText('Team member added')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(memberName)).toBeVisible({ timeout: 30_000 });

    // ── Invited member: fresh, unauthenticated browser context.
    let inviteContext: BrowserContext | undefined;
    try {
      inviteContext = await browser.newContext({
        baseURL: process.env.BASE_URL || 'http://localhost:5173',
      });
      const invitePage: Page = await inviteContext.newPage();

      await test.step('open the public accept-invitation link', async () => {
        await invitePage.goto(`/accept-invitation?token=${invitationId}`, {
          waitUntil: 'domcontentloaded',
        });
        // Join screen: "Join {org}" + the prefilled (locked) invite email.
        await expect(
          invitePage.getByRole('heading', { name: /join/i })
        ).toBeVisible({ timeout: 30_000 });
        await expect(invitePage.getByLabel('Email')).toHaveValue(memberEmail);
        await invitePage.getByRole('button', { name: /^continue$/i }).click();
      });

      await test.step('review-and-confirm is prefilled; accept terms', async () => {
        await expect(
          invitePage.getByRole('heading', { name: /review and confirm/i })
        ).toBeVisible({ timeout: 15_000 });
        // The owner-entered first/last name flowed through the invite prefill.
        await expect(invitePage.getByLabel('First name')).toHaveValue(
          firstName
        );
        await expect(invitePage.getByLabel('Last name')).toHaveValue(lastName);
        await invitePage
          .getByRole('checkbox', { name: /accept terms/i })
          .click();
        await invitePage.getByRole('button', { name: /^continue$/i }).click();
      });

      await test.step('set a password and accept the invite', async () => {
        await expect(
          invitePage.getByRole('heading', { name: /set a password/i })
        ).toBeVisible({ timeout: 15_000 });
        await invitePage
          .getByLabel('Password', { exact: true })
          .fill(memberPassword);
        await invitePage.getByLabel('Confirm password').fill(memberPassword);
        await invitePage
          .getByRole('button', { name: /accept invite/i })
          .click();
      });

      await test.step('walk (skip) through the self-onboarding wizard', async () => {
        // The wizard mounts on accept. Every step is optional; the shell's
        // "Skip" advances, and skipping the final step completes → navigates to
        // /dashboard/home. Each step has its own <h1>, so wait for THAT (the
        // real condition) before skipping on — no blind settle, and the walk
        // asserts every step actually rendered.
        const skip = invitePage.getByRole('button', { name: /^skip$/i });
        for (const heading of WIZARD_STEP_HEADINGS) {
          await expect(
            invitePage.getByRole('heading', { name: heading })
          ).toBeVisible({ timeout: 30_000 });
          await skip.click();
        }
        await invitePage.waitForURL(/\/dashboard/, {
          timeout: 30_000,
          waitUntil: 'domcontentloaded',
        });
      });

      await test.step('the new member is authenticated in the dashboard', async () => {
        await expect(invitePage).toHaveURL(/\/dashboard/);
        // Confirm the accepted member truly joined the OWNER's org with the
        // Medium→admin role, via their own session (independent of the UI).
        const inviteSeed = new SeedHelper(invitePage, invitePage.request);
        const activeOrgId = await inviteSeed.getActiveOrganizationId();
        expect(activeOrgId).toBe(orgId);
      });
    } finally {
      await inviteContext?.close();
    }

    // ── Cleanup: deactivate the created practitioner so re-runs stay clean.
    // (The invited `e2e.test.*` user + membership are reaped by global
    // teardown's `e2e.test.%` cleanup.)
    // `practitionerId` is asserted truthy at create time, so this is unconditional.
    await test.step('cleanup', async () => {
      await seed.authenticatedApiCall(
        'DELETE',
        `/practitioners/${practitionerId}`,
        undefined,
        [404]
      );
    });
  });
});
