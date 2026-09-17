import { openEditFirstTimeEntry } from '../fixtures/app.js';
import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — Timesheets. Broad-shallow, viewport-agnostic: the same flow runs on
 * desktop (`tabs`) and mobile (`tabs-mobile`). A fresh org reaches the surface
 * authenticated, and a clock-in seeded through the API (open time entry) shows
 * its practitioner in the timesheet (proves the read round-trip and the
 * clocked-in surface).
 *
 * Readiness is asserted on content (the always-rendered "From" date filter /
 * seeded practitioner name) rather than shell chrome, because team routes render
 * no mobile bottom-tab nav (see members.spec.ts for the full note).
 */
test.describe('Team · timesheets', () => {
  test('a fresh org reaches the timesheets page authenticated', async ({
    org,
  }) => {
    const { page } = org;
    await page.goto(await branchUrl(page, '/dashboard/team/timesheets'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(branchUrlPattern('team/timesheets'));
    // Readiness on the ClockedInStrip, which BOTH viewports render.
    //
    // This used to wait for the "From" date filter, described as rendering
    // "regardless of data/viewport" — it doesn't. The route splits into
    // TimesheetsDesktopPage / TimesheetsMobilePage: desktop has From+To date
    // pickers, mobile has a week stepper ("13 Jul – 19 Jul" with arrows) and no
    // From field at all. The assertion was desktop chrome, so mobile could only
    // ever time out. That is a wrong test, not a missing feature.
    await expect(page.getByText('Clocked in now')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a clocked-in practitioner shows in the timesheet', async ({ org }) => {
    const { page, seed } = org;
    const name = `E2E Timesheet ${Date.now()}`;
    const practitioner = await seed.createPractitioner({
      name,
      email: `e2e.timesheet.${Date.now()}@example.com`,
    });
    // Clock-in is gated behind a paid plan; grant one to this fresh org (the
    // testing endpoint bypasses Stripe checkout) so the seed prerequisite works.
    await seed.forceCreateSubscription(org.orgId);
    // Clock in through the org's own session (owner ⇒ can manage others). This
    // opens a time entry for the current week, which the default range renders.
    await seed.authenticatedApiCall('POST', '/time-entries/clock-in', {
      practitionerId: practitioner.id,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/timesheets'), {
      waitUntil: 'domcontentloaded',
    });
    // The open entry surfaces the practitioner name in both the clocked-in strip
    // and the entries table; either match proves the round-trip at both viewports.
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  });

  /**
   * DEEP FLOW: drive a full clock-in → break → clock-out → edit lifecycle.
   *
   * Clock-in, break and clock-out are all driven through the real UI (the
   * ClockedInStrip select + "Clock in"/"Start break"/"End break"/"Clock out"
   * buttons). Starting a break flips the chip to an "on break" state and swaps
   * the button to "End break"; ending it swaps back — we assert on that visible
   * state. The entry edit is driven through the EditTimeEntryDialog and re-read
   * to prove the new clock-in persisted.
   *
   * Viewport-agnostic: the strip, table row menu and edit dialog render at both
   * viewports; we assert on CONTENT + API round-trips and wait for overlays to
   * detach — so the same script drives `tabs` and `tabs-mobile`.
   */
  test('clock in, take a break, clock out, then edit the entry', async ({
    org,
  }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    const name = `E2E Clock ${stamp}`;
    await seed.createPractitioner({
      name,
      email: `e2e.clock.${stamp}@example.com`,
    });

    await page.goto(await branchUrl(page, '/dashboard/team/timesheets'), {
      waitUntil: 'domcontentloaded',
    });
    // Same viewport-agnostic readiness signal as above (mobile has no "From").
    await expect(page.getByText('Clocked in now')).toBeVisible({
      timeout: 30_000,
    });

    // CLOCK IN through the strip control.
    await page
      .getByRole('combobox', { name: /clock in a practitioner/i })
      .click();
    await page.getByRole('option', { name }).click();
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();

    // The strip now shows the clocked-in chip with per-entry break + clock-out
    // controls.
    await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible({
      timeout: 15_000,
    });

    // TAKE A BREAK through the strip control. Starting the break flips the chip
    // to an "on break" state and swaps the button to "End break".
    await page.getByRole('button', { name: 'Start break' }).first().click();
    await expect(page.getByRole('button', { name: 'End break' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('on break').first()).toBeVisible({
      timeout: 15_000,
    });

    // END THE BREAK — the control swaps back to "Start break".
    await page.getByRole('button', { name: 'End break' }).first().click();
    await expect(page.getByRole('button', { name: 'Start break' })).toBeVisible(
      { timeout: 15_000 }
    );

    // CLOCK OUT through the strip.
    await page.getByRole('button', { name: 'Clock out' }).first().click();
    await expect(page.getByText('No one is currently clocked in.')).toBeVisible(
      { timeout: 15_000 }
    );

    // The completed entry now appears for the current week. Open its edit
    // dialog — desktop via the row's `⋯ Open menu → Edit times`, mobile by
    // tapping the row (there is no row menu at that viewport). Same dialog.
    await openEditFirstTimeEntry(page);

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Edit time entry' })
    ).toBeVisible({ timeout: 15_000 });

    // Move the clock-in EARLIER than the just-recorded clock-out (≈ now). A
    // hardcoded "08:00" breaks whenever CI runs before 08:00 UTC: the new
    // clock-in would land AFTER the clock-out, the backend rejects clock-in >
    // clock-out, and the dialog never closes. Base it on now instead: one hour
    // back, clamped to the start of today so it never crosses midnight into the
    // previous week (which would also hide the edited entry). `datetime-local`
    // wants local wall time.
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    // One hour before now, but never before the start of today (so it can't
    // cross midnight into the previous week and hide the edited entry).
    const clockIn = new Date(
      Math.max(now.getTime() - 60 * 60 * 1000, startOfToday.getTime())
    );
    const clockInValue = `${clockIn.getFullYear()}-${pad(
      clockIn.getMonth() + 1
    )}-${pad(clockIn.getDate())}T${pad(clockIn.getHours())}:${pad(
      clockIn.getMinutes()
    )}`;
    await dialog.getByLabel('Clock in').fill(clockInValue);
    await dialog.getByRole('button', { name: /save changes/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Persistence: reopen the entry and confirm the clock-in value stuck.
    await openEditFirstTimeEntry(page);
    await expect(page.getByRole('dialog').getByLabel('Clock in')).toHaveValue(
      clockInValue,
      { timeout: 15_000 }
    );
  });
});
