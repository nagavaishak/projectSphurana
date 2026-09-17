import { addTeamMemberButton, entityEditorSave } from '../fixtures/app.js';
import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — Members (the practitioners roster; the route component is
 * `PractitionersPage`, "Add team member"). Broad-shallow, viewport-agnostic:
 * the same flow runs on desktop (`tabs`) and mobile (`tabs-mobile`).
 *
 * Note on readiness: unlike catalog/appointments, the team routes are NOT in the
 * mobile bottom-tab path list (see mobile-bottom-tab-routes.ts), so on mobile
 * neither the sidebar rail nor the `<nav aria-label="Main">` bottom bar renders —
 * `gotoSurface`/`expectAppReady` can't confirm the shell here. We instead assert
 * readiness on the page's own always-rendered content ("Add team member"), which
 * renders identically at both viewports and is an equivalently strong signal that
 * the authenticated surface mounted.
 */
test.describe('Team · members', () => {
  test('a fresh org reaches the members page authenticated', async ({
    org,
  }) => {
    const { page } = org;
    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    // If auth failed we'd be bounced to /sign-in; asserting the URL held proves
    // the per-test-org session is live.
    await expect(page).toHaveURL(branchUrlPattern('team/members'));
    // Viewport-agnostic shell/content readiness: the roster's primary action
    // renders regardless of data or viewport.
    await expect(addTeamMemberButton(page)).toBeVisible({ timeout: 30_000 });
  });

  test('a practitioner seeded via the API renders in the members list', async ({
    org,
  }) => {
    const { page, seed } = org;
    const name = `E2E Member ${Date.now()}`;
    await seed.createPractitioner({
      name,
      email: `e2e.member.${Date.now()}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    // The seeded name proves readiness + the read round-trip at both viewports
    // (desktop table / mobile list).
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
  });

  /**
   * DEEP FLOW: create a team member entirely through the "Add team member"
   * editor (first/last name + email are the only required fields — see
   * TeamMemberEditor), then assert the new member persists into the roster after
   * the create round-trips through the real API.
   *
   * The old "Add Practitioner" shadcn Dialog is gone: adding now opens the
   * full-screen TeamMemberEditor, which portals to <body> and is NOT a
   * `role="dialog"` — so everything here is scoped to the page, and the editor's
   * heading ("Add team member") is the readiness signal. Fields are first/last
   * name rather than one "Name". Viewport-agnostic: the editor renders at both
   * viewports and we assert on CONTENT (the name in the roster).
   */
  test('create a team member through the Add team member editor', async ({
    org,
  }) => {
    const { page } = org;
    const stamp = Date.now();
    const firstName = 'E2E';
    const lastName = `Member ${stamp}`;
    const email = `e2e.newmember.${stamp}@example.com`;

    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    await addTeamMemberButton(page).click({ timeout: 30_000 });

    await expect(
      page.getByRole('heading', { name: 'Add team member' })
    ).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('First name').fill(firstName);
    await page.getByLabel('Last name').fill(lastName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Job title').fill('Senior Stylist');
    // The unified entity editor owns the action and labels it "Save" (it was
    // "Add" before §6 folded every create/edit surface into one chrome). Page
    // level, not `content()`: the editor is a FIXED OVERLAY rendered outside
    // the SidebarInset.
    await entityEditorSave(page).click();

    // The create hook closes the editor on success — wait for it to detach so
    // the closing surface can't intercept the roster assertion.
    await expect(
      page.getByRole('heading', { name: 'Add team member' })
    ).toBeHidden({ timeout: 15_000 });

    // Persistence: the roster refetches and renders the new member (both the
    // desktop table and mobile list surface the name identically).
    await expect(page.getByText(`${firstName} ${lastName}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  });
});
