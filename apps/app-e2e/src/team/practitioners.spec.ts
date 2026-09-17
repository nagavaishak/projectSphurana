import { addTeamMemberButton } from '../fixtures/app.js';
import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — Practitioners. This legacy path is a route-level redirect to
 * `members` (see routes/_authed/dashboard/team/practitioners.tsx). Broad-shallow,
 * viewport-agnostic: the redirect lands on the members roster authenticated on
 * both desktop (`tabs`) and mobile (`tabs-mobile`), so old links keep working.
 *
 * Readiness is asserted on the roster's own content ("Add team member") rather
 * than shell chrome, because team routes render no mobile bottom-tab nav (see
 * members.spec.ts for the full note).
 */
test.describe('Team · practitioners', () => {
  test('the legacy practitioners path redirects to members authenticated', async ({
    org,
  }) => {
    const { page } = org;
    await page.goto(await branchUrl(page, '/dashboard/team/practitioners'), {
      waitUntil: 'domcontentloaded',
    });
    // beforeLoad throws a redirect to /dashboard/team/members; a bounce to
    // /sign-in would mean auth failed.
    await expect(page).toHaveURL(branchUrlPattern('team/members'));
    // The redirected roster rendered authed (viewport-agnostic).
    await expect(addTeamMemberButton(page)).toBeVisible({ timeout: 30_000 });
  });
});
