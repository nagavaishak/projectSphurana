import {
  gotoSurface,
  isMobile,
  listRow,
  listRowMenu,
  openListRowEdit,
} from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team / scheduling — blocked time. Two DEEP FLOWS:
 *
 * 1) Blocked-time TYPES full CRUD through the Settings UI
 *    (`/dashboard/settings/blocked-time-types`): create a preset, edit its name,
 *    delete it (native `window.confirm` auto-accepted).
 *
 * 2) Create a blocked TIME through the calendar's "Add blocked time" dialog
 *    (the only UI entry point — the dialog is the calendar's
 *    `secondaryAddDialog`), then assert BOTH that the calendar renders it (the
 *    agenda view lists the block under its title) and that it persisted through
 *    the real `GET /blocked-time` API.
 *
 * Viewport-agnostic: the Settings table + dialogs and the calendar header button
 * ("Add blocked time", `w-full sm:w-auto`) render at both viewports; we assert
 * on CONTENT (row cells, API round-trip) and wait for dialogs to detach before
 * the next action — so the same script drives `tabs` and `tabs-mobile`.
 */
/**
 * Create a blocked time through the calendar UI. The entry point is a DIFFERENT
 * component per viewport (desktop dialog vs the mobile full-page block route),
 * so the divergence lives here, in a named helper outside the test body — both
 * branches are real, asserted paths. Returns the title the block will render
 * under (mobile titles it from the reason preset).
 */
async function createBlockThroughCalendarUi(
  page: import('@playwright/test').Page,
  desktopTitle: string
): Promise<string> {
  if (isMobile(page)) {
    // Mobile: the full-page block route. The defaults are NOT sufficient — Type
    // defaults to "Custom", which REQUIRES a title, so saving with an empty one
    // just renders "Title is required" and never POSTs. Fill the SAME title
    // desktop uses so both viewports create the same block.
    await gotoSurface(page, '/dashboard/calendar/new/block');
    await page.getByLabel('Title').fill(desktopTitle);
    await page.getByRole('button', { name: 'Save Block' }).click();
    return desktopTitle;
  }

  // Desktop: the day header's "Add" split-menu → "Blocked time" opens the
  // blocked-time dialog (the calendar's `secondaryAddDialog`). There is no
  // standalone "Add blocked time" button on the day view.
  await gotoSurface(page, '/dashboard/calendar/day');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blocked time' }).click();

  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Add blocked time' })
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel('Title').fill(desktopTitle);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  return desktopTitle;
}

test.describe('Team · blocked time', () => {
  test('blocked-time types: create, edit, delete', async ({ org }) => {
    const { page } = org;
    // The delete path uses a native window.confirm — auto-accept it.
    page.on('dialog', (d) => d.accept());

    const stamp = Date.now();
    const typeName = `E2E BlockType ${stamp}`;
    const renamed = `${typeName} (edited)`;

    await page.goto('/dashboard/settings/blocked-time-types', {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { name: 'Blocked time types' })
    ).toBeVisible({ timeout: 30_000 });

    // CREATE — the header "Add type" (the empty-state also renders one, so take
    // the first).
    await page.getByRole('button', { name: 'Add type' }).first().click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'New blocked time type' })
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel('Name').fill(typeName);
    // Defaults: 1h duration, Unpaid. Create.
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // `listRow`, not `getByRole('cell')`: ListPage renders a table on desktop
    // and a card list on mobile, and this spec runs at both viewports.
    await expect(listRow(page, typeName)).toBeVisible({ timeout: 15_000 });

    // EDIT — rename. Desktop goes through the row menu; mobile taps the row.
    await openListRowEdit(page, typeName);
    dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Edit blocked time type' })
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel('Name').fill(renamed);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(listRow(page, renamed)).toBeVisible({ timeout: 15_000 });

    // DELETE — via the row menu, then the confirmation.
    //
    // This used to rely on the `page.on('dialog')` handler above: deletion was a
    // native `window.confirm`. It is now a real `alertdialog` naming the type,
    // so the handler never fires and the dialog simply sat there unanswered —
    // the row stayed, and the failure read as "delete does not work".
    // Delete is menu-only at BOTH viewports (the mobile row tap opens edit),
    // so this one is scoped to the row rather than dispatched on viewport.
    await listRowMenu(page, renamed).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(listRow(page, renamed)).toBeHidden({ timeout: 15_000 });
  });

  test('create a blocked time via the calendar', async ({ org }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    // Flip the org onto Borradh's built-in calendar — otherwise the day view
    // renders the "connect a calendar" state and never mounts the calendar grid
    // + its "Add" menu that opens the blocked-time dialog.
    await seed.authenticatedApiCall('PATCH', '/organization/active', {
      bookingDestination: 'borradh',
    });
    // Seed a practitioner so the calendar renders a staff column and the
    // dialog's team-member multi-select has options (we keep the "whole team"
    // default, so a block is created regardless).
    await seed.createPractitioner({
      name: `E2E BlockStaff ${stamp}`,
      email: `e2e.blockstaff.${stamp}@example.com`,
    });

    const expectedTitle = await createBlockThroughCalendarUi(
      page,
      `E2E Blocked ${stamp}`
    );

    // UI: the calendar RENDERS the block. `appointments-provider` maps blocked
    // times onto calendar events (`blockedTimeToEvent`), and the agenda view is
    // the same component at both viewports — so the created block must show up
    // there under its title. This is the assertion that fails if the calendar
    // stops surfacing blocked time; the API poll below is the persistence
    // backstop, not the whole check.
    await gotoSurface(page, '/dashboard/calendar/agenda');
    await expect(page.getByText(expectedTitle).first()).toBeVisible({
      timeout: 30_000,
    });

    // Persistence: the block round-trips through the API (query a wide window
    // around today; the block sits on today).
    const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    await expect
      .poll(
        async () => {
          const list = (await seed.authenticatedApiCall(
            'GET',
            `/blocked-time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
          )) as Array<{ title: string }>;
          return (
            Array.isArray(list) && list.some((b) => b.title === expectedTitle)
          );
        },
        { timeout: 15_000, intervals: [1_000, 2_000, 3_000] }
      )
      .toBe(true);
  });
});
