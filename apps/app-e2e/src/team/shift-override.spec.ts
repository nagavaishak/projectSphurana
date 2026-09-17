import { deleteShiftOverride, openShiftOverride } from '../fixtures/app.js';
import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — single-day shift override. DEEP FLOW: seed a practitioner, then on
 * the weekly roster (`/dashboard/team/shifts`) add a one-day shift override to a
 * "Not working" day and then delete it again, asserting the cell flips between
 * the rendered interval and "Not working" as the override is created and
 * removed (each round-trips through the real API).
 *
 * A fresh practitioner has no standing weekly shifts, so every day cell renders
 * a "Not working" button that opens the ShiftOverrideDialog (default 10:00–19:00
 * interval). Saving writes a date override; the cell then renders the interval
 * as a popover trigger whose menu offers "Delete this shift" (→ deletes the
 * override, since `resolved.source === 'override'`).
 *
 * Viewport-agnostic: the roster grid scrolls inside its own `overflow-x-auto`
 * wrapper and the dialog/popover are the same at both viewports; we assert on
 * CONTENT (the rendered "10:00am – 7:00pm" label) and wait for the dialog to
 * detach before touching the cell, so the same script drives `tabs` and
 * `tabs-mobile`.
 */
test.describe('Team · shift override', () => {
  test('add a day override then delete it', async ({ org }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    const name = `E2E Override ${stamp}`;
    await seed.createPractitioner({
      name,
      email: `e2e.override.${stamp}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/shifts'), {
      waitUntil: 'domcontentloaded',
    });
    // Readiness + the practitioner row rendered (its cells are our targets).
    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });

    // Open the override editor. Desktop clicks a "Not working" cell in the
    // weekly grid; mobile has no grid — it taps the practitioner's row in the
    // day roster. Same ShiftOverrideDialog, so the dispatch lives in the fixture.
    await openShiftOverride(page);

    const dialog = page.getByRole('dialog');
    const saveBtn = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(saveBtn).toBeVisible({ timeout: 15_000 });
    // Keep the seeded default interval (10:00–19:00) and save the override.
    await saveBtn.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // The override now renders at BOTH viewports — desktop as the cell's popover
    // trigger button, mobile as the roster row's subtitle — so assert the
    // interval as TEXT rather than as a desktop-only button role.
    await expect(page.getByText(/10:00am/).first()).toBeVisible({
      timeout: 15_000,
    });

    // Delete it. Desktop goes through the cell popover; mobile re-opens the
    // ShiftOverrideDialog and uses its "Delete this day's shifts" button.
    await deleteShiftOverride(page);

    // Persistence: the cell reverts to "Not working" and the interval is gone.
    // toHaveCount(0), not toBeHidden(): the interval can appear more than once
    // (roster row + the dialog's own time controls), and toBeHidden() on a
    // multi-match locator is a strict-mode violation. Count is the assertion we
    // actually mean — the override is GONE.
    await expect(page.getByText(/10:00am/)).toHaveCount(0, { timeout: 15_000 });
  });
});
