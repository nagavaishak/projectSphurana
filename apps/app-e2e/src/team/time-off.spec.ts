import { openAddTimeOff } from '../fixtures/app.js';
import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — time off. DEEP FLOW: seed a practitioner, then from the weekly
 * roster (`/dashboard/team/shifts`) open the "Add" → "Time off" dialog, pick the
 * team member, and save a default (today 09:00–17:00, approved) time-off entry.
 * The save is asserted on-screen (the "Time off added" toast) and then read back
 * through the real time-off API.
 *
 * Why no "the entry renders" assertion: the app has NO read surface for time off.
 * `useListTimeOff` has zero consumers — the shifts roster only hosts the dialog,
 * and the calendar's appointments-provider maps appointments + blocked time only.
 * Time off is write-only in the product today; when a read surface lands, assert
 * the entry renders on it here.
 *
 * Viewport-agnostic: the "Add" split button, its menu, and the TimeOffDialog are
 * the same at both viewports; we scope fields to the dialog, wait for it to
 * detach after save (mirrors the checkout close-overlay guard), and verify
 * persistence via `GET /time-off` rather than desktop chrome — so the same
 * script drives `tabs` and `tabs-mobile`.
 */
test.describe('Team · time off', () => {
  test('create a time-off entry for a team member', async ({ org }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    const name = `E2E TimeOff ${stamp}`;
    const practitioner = await seed.createPractitioner({
      name,
      email: `e2e.timeoff.${stamp}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/shifts'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });

    // Open the Add-time-off dialog. The chrome differs by viewport (desktop
    // `Add ▾ → Time off`; mobile a header icon button labelled "Add time off"),
    // so the dispatch lives in the fixture — the dialog it opens is the same,
    // and that is what the rest of this test asserts against.
    await openAddTimeOff(page);

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Add time off' })
    ).toBeVisible({ timeout: 15_000 });

    // Pick the seeded team member (the only required non-defaulted field).
    await dialog.getByLabel('Team member').click();
    await page.getByRole('option', { name }).click();

    // Defaults: type Annual Leave, today 09:00–17:00, approved. Save.
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    // UI: the only on-screen signal the app gives for a saved entry — the
    // "Time off added" toast raised by `useCreateTimeOff` on a successful
    // round-trip. There is NO read surface for time off anywhere in the app
    // (`useListTimeOff` has zero consumers: the roster and the calendar's
    // appointments-provider render appointments + blocked time only), so a
    // "the entry renders" assertion is impossible today — the toast plus the
    // API round-trip below are the strongest honest checks. (Product gap: time
    // off is write-only.)
    await expect(page.getByText('Time off added')).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Persistence: the entry round-trips through the API. Query a wide window
    // around today (the default entry sits on today) via the org's session.
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await expect
      .poll(
        async () => {
          const list = (await seed.authenticatedApiCall(
            'GET',
            `/time-off?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
          )) as Array<{ practitionerId: string }> | { items?: unknown };
          const items = Array.isArray(list) ? list : [];
          return items.some((t) => t.practitionerId === practitioner.id);
        },
        { timeout: 15_000, intervals: [1_000, 2_000, 3_000] }
      )
      .toBe(true);
  });
});
