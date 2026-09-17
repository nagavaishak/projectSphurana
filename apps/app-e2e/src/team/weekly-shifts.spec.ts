import { showRosterDay } from '../fixtures/app.js';
import { branchUrlPattern } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Team tab — weekly (repeating) shift editor. DEEP FLOW: seed a practitioner via
 * the API, open their standing weekly-shift editor
 * (`/team/repeating-shifts/:practitionerId`), turn on a working day, save, and
 * assert the saved hours persist by reading them back off the weekly roster
 * grid (`/dashboard/team/shifts`), which refetches from the API.
 *
 * The editor is a full-screen route (own `min-h-dvh` layout — NOT the dashboard
 * sidebar shell), so we navigate directly by id and assert readiness on its own
 * h1 ("Set {name}'s repeating shifts") rather than `expectAppReady`. A brand-new
 * practitioner inherits the default working week (Mon–Fri on, Sat/Sun off), so
 * we toggle a day that starts OFF — Sunday — and checking it seeds the default
 * 10:00–19:00 interval (see RepeatingShiftsPage.toggleDay / DEFAULT_INTERVAL).
 * Saving navigates back to the roster.
 *
 * Viewport-agnostic: the day checkboxes (aria-labelled by day name) and the
 * sticky Save button render at both viewports (the two-column editor collapses
 * to one column on mobile), and the roster grid scrolls inside its own
 * `overflow-x-auto` wrapper — so the same script drives `tabs` and
 * `tabs-mobile`. We assert on the rendered shift label ("10:00am – 7:00pm"),
 * which appears only in the one day cell we enabled.
 */
test.describe('Team · weekly shifts', () => {
  test("set a practitioner's weekly hours and assert they persist", async ({
    org,
  }) => {
    const { page, seed } = org;
    const stamp = Date.now();
    const name = `E2E Weekly ${stamp}`;
    const practitioner = await seed.createPractitioner({
      name,
      email: `e2e.weekly.${stamp}@example.com`,
    });

    await page.goto(`/team/repeating-shifts/${practitioner.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { name: /repeating shifts/i })
    ).toBeVisible({ timeout: 30_000 });

    // The page must not scroll SIDEWAYS. Each day row used to be a rigid flex
    // row — a fixed `w-40` label column beside two `w-32` time selects — which
    // needs ~580px and so overflowed a 412px phone: the body scrolled
    // horizontally and the controls were cut off at the viewport edge. Cheap,
    // exact, and it holds at both viewports.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `page overflows horizontally: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth);

    // Enable Sunday — a day that starts OFF (the default week is Mon–Fri), so
    // toggling it on is an unambiguous change. This seeds the default
    // 10:00–19:00 interval. The Radix checkbox exposes the day name as its
    // aria-label. (The editor gates the grid on the pattern having seeded, so
    // the checkbox only appears once the standing pattern has loaded — a click
    // here can't be clobbered by a late-arriving seed.)
    const sunday = page.getByRole('checkbox', { name: 'Sunday' });
    await sunday.click();
    await expect(sunday).toBeChecked();

    // Save writes the weekly pattern and navigates back to the roster.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(branchUrlPattern('team/shifts'), { timeout: 30_000 });

    // Persistence: the roster refetches and the practitioner's SUNDAY now renders
    // the saved interval. `formatMinutesLabel` renders 12-hour labels, so
    // 10:00–19:00 shows as "10:00am – 7:00pm".
    //
    // Desktop shows the whole WEEK at once, so Sunday is already on screen.
    // Mobile shows ONE day (today), so the change we just made to Sunday is not
    // visible until Sunday is selected — the assertion below could only ever fail
    // there. Bring the day into view first; no-op on desktop.
    await showRosterDay(page, /^Sunday/);

    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/10:00am/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/7:00pm/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
