import type { Page } from '@playwright/test';
import { entityEditorNav, isMobile } from '../fixtures/app.js';
import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — wage config. DEEP FLOW: seed a practitioner, edit them from the
 * members roster, open the "Wages and timesheets" section, set an hourly
 * compensation + rate, and save. Persistence is the real assertion: after the
 * editor closes we RELOAD and re-read the rate from the server, so a backend
 * that 200s and drops the write cannot pass.
 *
 * Viewport-agnostic: the roster row menu and the TeamMemberEditor render at both
 * viewports and we never touch desktop chrome — so the same script drives `tabs`
 * and `tabs-mobile`.
 */

/**
 * Open the TeamMemberEditor for the first roster row.
 *
 * Desktop goes through the row's `⋯ Open menu → Edit`; the mobile roster has no
 * row menu — the row itself is the control (MobileRecordRow `onClick`). Same
 * editor either way, so the chrome difference is absorbed here.
 */
async function openEditor(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.locator('[data-testid^="team-member-row-"]').first().click();
  } else {
    // The roster remounts when its query settles. Keep opening the menu and
    // selecting Edit in the same retryable unit so a remounted menu cannot
    // leave the test clicking a detached menu item.
    await expect(async () => {
      await page.getByRole('button', { name: 'Open menu' }).first().click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      await expect(
        page.getByRole('heading', { name: 'Edit team member' })
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    return;
  }
  await expect(
    page.getByRole('heading', { name: 'Edit team member' })
  ).toBeVisible({ timeout: 15_000 });
}
test.describe('Team · wage config', () => {
  test("set a practitioner's wage config and see the save confirmation", async ({
    org,
  }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    const name = `E2E Wage ${stamp}`;
    await seed.createPractitioner({
      name,
      email: `e2e.wage.${stamp}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });

    // Edit the practitioner via the row menu. This opens the full-screen
    // TeamMemberEditor ("Edit team member") — the old "Edit Practitioner" shadcn
    // Dialog with a Wages TAB is gone. The editor portals to <body> and is not a
    // `role="dialog"`, so scope to the page; Wages is now a left-nav SECTION
    // ("Wages and timesheets") and the rate is saved by the editor's own Save.
    await openEditor(page);

    // In EDIT mode the Wages section renders the SELF-SAVING WageConfigForm
    // (WagesPanel branches on `practitionerId`) — the editor's own "Save" writes
    // the practitioner, services and locations, NOT the wage config. So the wage
    // form has its own "Save wage settings" button and its own toast.
    // Scoped to the editor's own section nav: on desktop that is a `<nav>`, on
    // mobile a row of pills, and page-wide the name also matches content.
    await entityEditorNav(page)
      .getByRole('button', { name: 'Wages and timesheets' })
      .click({ timeout: 15_000 });
    await page.getByLabel('Compensation').click();
    await page.getByRole('option', { name: 'Hourly Rate' }).click();
    await page.getByLabel('Hourly rate').fill('18.50');
    await page.getByRole('button', { name: 'Save wage settings' }).click();

    await expect(page.getByText('Wage settings saved')).toBeVisible({
      timeout: 15_000,
    });

    // PERSISTENCE (the toast alone would pass against a backend that 200s and
    // drops the write): RELOAD and re-read the value from the server. The form
    // hydrates from `GET` wage-config and renders cents back in major units
    // (`centsToInput`: 1850 ⇒ "18.5"), so re-opening must show the saved rate.
    await page.goto(await branchUrl(page, '/dashboard/team/members'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
    await openEditor(page);

    // Scoped to the editor's own section nav: on desktop that is a `<nav>`, on
    // mobile a row of pills, and page-wide the name also matches content.
    await entityEditorNav(page)
      .getByRole('button', { name: 'Wages and timesheets' })
      .click({ timeout: 15_000 });
    await expect(page.getByLabel('Hourly rate')).toHaveValue('18.5', {
      timeout: 15_000,
    });
  });
});
