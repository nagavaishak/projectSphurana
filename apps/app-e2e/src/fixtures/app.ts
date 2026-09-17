import { type Locator, type Page, expect } from '@playwright/test';

import { branchUrl } from './branch.fixture.js';

/**
 * Viewport-agnostic app-shell + navigation helpers.
 *
 * The tab suites run through TWO projects — `tabs` (Desktop Chrome) and
 * `tabs-mobile` (Pixel 7) — off the SAME spec files, so specs must not assert
 * desktop-only chrome. These helpers absorb the differences: on desktop the
 * sidebar rail renders; on mobile it collapses and the bottom-tab
 * `<nav aria-label="Main">` (MobileBottomTabs) renders instead. Specs assert on
 * CONTENT (seeded data, headings, field labels) and use these for chrome.
 */

/** True when the current test runs at a mobile viewport (< 768px wide). */
export function isMobile(page: Page): boolean {
  const size = page.viewportSize();
  return !!size && size.width < 768;
}

/**
 * Wait until the authenticated app shell has loaded, regardless of viewport.
 * Desktop → the sidebar menu button; mobile → the bottom-tab "Main" nav. Use
 * this instead of a raw `[data-sidebar="menu-button"]` selector so the same
 * spec passes in both `tabs` and `tabs-mobile`.
 */
export async function expectAppReady(page: Page): Promise<void> {
  // Any one of these proves we're inside the authenticated dashboard shell
  // (i.e. not bounced to /sign-in), across every route + viewport:
  //  - desktop sidebar menu button
  //  - mobile bottom-tab "Main" nav (only on bottom-tab routes)
  //  - the SidebarInset `<main data-slot="sidebar-inset">` content container,
  //    which every authed route renders at both viewports (robust fallback for
  //    routes not in the mobile bottom-tab list, e.g. team/*).
  const shell = page
    .locator('[data-sidebar="menu-button"]')
    .or(page.getByRole('navigation', { name: 'Main' }))
    .or(page.locator('[data-slot="sidebar-inset"]'));
  await expect(shell.first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Navigate to a dashboard route and wait for the shell — the viewport-agnostic
 * "open this surface authenticated" primitive every tab spec starts from.
 *
 * Branch-scoped paths are resolved through `branchUrl()`, so a spec may pass
 * either the plain sub-path (`/dashboard/calendar/week`) or an already-scoped
 * one and land on the same surface without going through the compatibility
 * splat's redirect. Org-level paths pass through untouched.
 */
export async function gotoSurface(page: Page, path: string): Promise<void> {
  await page.goto(await branchUrl(page, path), {
    waitUntil: 'domcontentloaded',
  });
  await expectAppReady(page);
}

/**
 * The page's CONTENT region, excluding the app chrome.
 *
 * Use this instead of bare `page.getByRole(...)` whenever the thing you are
 * looking for has a name that could also appear in the sidebar, the user menu
 * or the location switcher. That is not hypothetical: `org.fixture` derives the
 * test USER'S NAME from the test title, so a test called "create a team member
 * through the Add team member editor" produces a user called "E2E create a team
 * member through the Add team member editor User" — whose name sits in the user
 * menu and matches `getByRole('button', { name: /add team member/i })`. The
 * result is a strict-mode violation naming four elements, or worse, a click
 * that opens the account menu and a timeout three lines later.
 *
 * `[data-slot="sidebar-inset"]` is the SidebarInset container every authed
 * route renders its page into, at both viewports.
 */
export function content(page: Page): Locator {
  return page.locator('[data-slot="sidebar-inset"]');
}

/**
 * The `⋯` actions trigger inside a `ListPage` row.
 *
 * `exact: true` matters: on mobile the whole row is itself a `<button>` whose
 * accessible name ENDS with "Open menu" (it concatenates every child's text),
 * so a non-exact match resolves to two elements and throws a strict-mode
 * violation naming the row and the trigger.
 */
export function listRowMenu(page: Page, name: string | RegExp): Locator {
  return listRow(page, name).getByRole('button', {
    name: 'Open menu',
    exact: true,
  });
}

/**
 * Open a `ListPage` row's EDIT surface, at either viewport.
 *
 * Same dialog, different chrome — the same shape as `openEditFirstTimeEntry`:
 *   desktop → the row's `⋯ Open menu` → "Edit"
 *   mobile  → tap the row itself (`ListPage`'s `onRowClick`), because the card
 *             list makes the whole row the primary affordance
 *
 * The dispatch lives here, in a named helper, because a spec may not branch on
 * the viewport in its own body (see the Skip Policy) — and because a spec that
 * only knew the desktop path failed on mobile with "waiting for menuitem Edit"
 * while the edit dialog it wanted was already open behind the assertion.
 */
export async function openListRowEdit(
  page: Page,
  name: string | RegExp
): Promise<void> {
  if (isMobile(page)) {
    await listRow(page, name).click();
    return;
  }
  await listRow(page, name).getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
}

/**
 * The inbox's conversation list, at either viewport.
 *
 * Two different renderers: on desktop `dashboard-layout-shell` owns a 300px
 * column (marked `data-conversations-list`); on mobile the route renders the
 * panel inline and that column is `md:flex`, so it is correctly absent. The
 * dispatch lives here, in a named helper, because a spec may not branch on the
 * viewport in its own body (see the Skip Policy).
 *
 * Matched by marker rather than by width, so a restyle cannot silently pass.
 */
export function conversationList(page: Page): Locator {
  return isMobile(page)
    ? // The mobile arm renders the panel inline inside a MobilePageShell; its
      // "Messages" title is the proof a LIST surface is present rather than
      // just the empty detail pane. (The desktop and mobile panels use
      // different search controls, so the search box is not a shared signal.)
      page.getByRole('heading', { name: 'Messages', level: 1 })
    : page.locator('[data-conversations-list]');
}

/**
 * A `ListPage` header action ("Add Customer", "Add type", …), at either
 * viewport.
 *
 * `ListPage` mounts BOTH label variants at once — `<span className="md:hidden">`
 * and `<span className="hidden md:inline">` — inside two buttons, so a plain
 * `getByRole('button', { name })` is a strict-mode violation naming two
 * elements that differ only in which CSS breakpoint reveals them. Filtering to
 * the visible one is what makes the same spec run at both viewports.
 */
export function listAction(page: Page, name: string | RegExp): Locator {
  return content(page)
    .getByRole('button', { name })
    .locator('visible=true')
    .first();
}

/**
 * A row of the unified `ListPage`, at either viewport.
 *
 * `ListPage` renders a real TABLE on desktop (`data-table.tsx`, so
 * `getByRole('cell')` works) and a card list of `<li>`s on mobile
 * (`mobile-list.tsx`), which has no table semantics at all — so a
 * `getByRole('cell')` assertion silently finds nothing there and the spec fails
 * on mobile for a reason that has nothing to do with what it is testing.
 *
 * Matches on the row's TEXT, which is identical at both viewports, and
 * CASE-INSENSITIVELY for a string: the app title-cases names on write (and the
 * desktop list additionally applies a CSS text-transform that Chromium folds
 * into the accessible name), so a seeded `E2EList123` comes back as
 * `E2elist123`. Pass a RegExp if you need exact case.
 */
export function listRow(page: Page, name: string | RegExp): Locator {
  const text =
    typeof name === 'string' ? new RegExp(escapeRegExp(name), 'i') : name;
  // `li:not([data-sonner-toast])`: sonner renders each toast as an `<li>`, and
  // the toast confirming a mutation quotes the row's name — so a bare `li`
  // match meant "row is gone" could never become true after a delete, because
  // the success toast kept matching.
  return content(page)
    .locator('tr, li:not([data-sonner-toast])')
    .filter({ hasText: text })
    .first();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The unified entity editor's section nav ("Profile", "Services", "Locations",
 * "Settings", "Wages and timesheets", …).
 *
 * The editor is a FIXED OVERLAY and its section names collide with the app
 * sidebar behind it, so nav clicks have to be scoped. Anchored on a
 * `data-testid` rather than the element or a group label: this spec used to
 * scope with `locator('aside').filter({ has: getByText('Personal') })`, and
 * both halves went stale — the nav is a `<nav>`, and the "Personal" group label
 * no longer exists. One editor serves ten entity types, so the hook is worth
 * having.
 */
export function entityEditorNav(page: Page): Locator {
  // Desktop renders a `<nav>` of section buttons; mobile renders a row of
  // section PILLS instead. Both carry this hook and both are MOUNTED — they are
  // hidden from each other by CSS — so filter to the one on screen.
  return page.getByTestId('entity-editor-nav').locator('visible=true');
}

/**
 * The entity editor's save action, at either viewport.
 *
 * Not `getByRole('button', { name: 'Save' })`: desktop labels it from the
 * editor's `saveLabel` (default "Save") while the mobile save bar hardcodes
 * "Save Changes" — so a name-based locator passes on one viewport and times out
 * on the other. (The copy divergence is real and worth a product decision;
 * this hook just stops the suite depending on it.)
 */
export function entityEditorSave(page: Page): Locator {
  // BOTH save buttons are mounted at once — the desktop one and the mobile save
  // bar are hidden from each other by CSS (`hidden md:flex` / `md:hidden`), not
  // unmounted — so the hook alone is a strict-mode violation. Filter to the one
  // actually on screen.
  return page.getByTestId('entity-editor-save').locator('visible=true');
}

/**
 * Fill a CONTROLLED form field and prove the value survived.
 *
 * `fill()` sets the DOM value and dispatches one input event, then reports
 * success — it cannot know whether React kept the value. The entity editor
 * re-renders after the first field's state lands, and a field caught in that
 * window comes back EMPTY. Playwright fills consecutive fields microseconds
 * apart and lands inside it; a human typing never does, which is why this
 * reproduces only under test and only sometimes. The tell is the `useId`
 * on the empty input (`id="«r1g»-form-item"`) — those are regenerated on
 * remount.
 *
 * Observed on `create/customer`: First Name held, Email came back `""` through
 * nine retries, and the failure surfaced 15s later as a missing success toast
 * with no hint that a field was empty. ~2 runs in 3, and MORE often
 * single-worker than with four.
 *
 * Re-fills rather than asserting once, because the remount can land after the
 * first successful check. Every entity editor field is worth routing through
 * this — one editor serves ten entity types.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * The "Add team member" action on the Team › Members surface.
 *
 * Scoping to the content region is what makes this unambiguous: page-wide there
 * are two or more matches (the account menu carries the test user's name, which
 * derives from the test title — see `content`), and inside the content region
 * there is exactly one.
 */
export function addTeamMemberButton(page: Page): Locator {
  return content(page)
    .getByRole('button', { name: /add team member/i })
    .first();
}

/**
 * Open the "Add time off" dialog from the Shifts surface, at either viewport.
 *
 * Both viewports reach the SAME dialog, by different chrome:
 *   desktop → an `Add ▾` dropdown whose one item is "Time off"
 *   mobile  → a header icon button labelled "Add time off" (CalendarOff)
 *
 * The dispatch lives here, in a named fixture helper, because the specs
 * themselves may not branch (`if` in a test body is what every bad conditional
 * skip is built from — see the Skip Policy). The spec asserts on the dialog that
 * results, which is the thing under test; this only absorbs the chrome.
 */
export async function openAddTimeOff(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Add time off' }).click();
    return;
  }
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Time off' }).click();
}

/**
 * Open the ShiftOverrideDialog from the Shifts surface, at either viewport.
 *   desktop → click a "Not working" cell in the weekly grid
 *   mobile  → tap the practitioner's row in the day roster (there is no grid)
 */
export async function openShiftOverride(page: Page): Promise<void> {
  if (isMobile(page)) {
    // Land on a day that is OFF in the standing pattern, so the dialog seeds its
    // default 10:00–19:00 interval — exactly what desktop gets by clicking a
    // "Not working" cell. Tapping the row on the CURRENT day would open an
    // already-working day (Mon–Fri default) and "saving" would just re-save
    // 9:00–18:00, so the two viewports would not be overriding the same thing.
    // The day tabs label themselves `EEEE d MMMM` ("Sunday 12 July").
    await page.getByRole('tab', { name: /^Sunday/ }).click();
    await page.locator('[data-testid^="shift-row-"]').first().click();
    return;
  }
  await page.getByRole('button', { name: 'Not working' }).first().click();
}

/**
 * A line of the daily summary, at either viewport.
 *
 * Desktop renders the summary as a TABLE (`role="row"`); mobile renders
 * `MobileRecordRow`s, which are `<li>`s with no table semantics — so
 * `getByRole('row')` finds nothing there. Pass a case-INSENSITIVE matcher: the
 * copy differs ("Total Sales" on desktop, "Total sales" on mobile).
 */
export function summaryRow(page: Page, label: RegExp): Locator {
  if (isMobile(page)) {
    return page.locator('li').filter({ hasText: label });
  }
  return page.getByRole('row', { name: label });
}

/**
 * The list entry for a sale, at either viewport.
 *
 * Desktop renders the sales list as a TABLE (`role="row"`); mobile renders it as
 * a card list (`MobileRecordRow`, `data-testid="sale-row-<id>"`) with no table
 * semantics at all — so `getByRole('row')` simply finds nothing there. Specs
 * assert on the returned locator's CONTENT (e.g. "Voided"), which is the same at
 * both viewports.
 */
export function saleRow(
  page: Page,
  opts: { saleId: string; clientName: string }
): Locator {
  if (isMobile(page)) {
    return page.locator(`[data-testid="sale-row-${opts.saleId}"]`);
  }
  // The desktop list capitalizes the client name via CSS text-transform, which
  // Chromium folds into the row's accessible name — hence the case-insensitive
  // match ("E2E Void Client" renders as "E2e Void Client").
  return page.getByRole('row', {
    name: new RegExp(opts.clientName, 'i'),
  });
}

/**
 * Bring a given weekday into view on the Shifts roster.
 *
 * Desktop renders the WEEKLY grid — every day is already on screen, so this is a
 * no-op. Mobile renders a DAY roster pinned to the selected day, so a change made
 * to (say) Sunday is simply not visible until you select Sunday: its day tabs are
 * labelled `EEEE d MMMM` ("Sunday 12 July").
 */
export async function showRosterDay(page: Page, day: RegExp): Promise<void> {
  if (!isMobile(page)) return;
  await page.getByRole('tab', { name: day }).click();
}

/**
 * Delete the currently-open BLOCKED TIME from its detail surface.
 *
 * A block is not an appointment, and the calendar says so: appointments offer
 * "Cancel booking", blocks offer a delete. The spec used to click "Cancel
 * booking" for a block at both viewports — a control that does not exist on that
 * surface — so it could never pass.
 *
 *   desktop → EventDetailsDialog's `Delete` (fires immediately, no confirm)
 *   mobile  → MobileBlockedTimeForm's `Delete block` → confirm `Delete`
 */
export async function deleteOpenBlock(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Delete block' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor({ state: 'visible', timeout: 15_000 });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    return;
  }
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .first()
    .click();
}

/**
 * Delete the shift override just created, at either viewport.
 *   desktop → the overridden cell renders the interval as a popover trigger;
 *             open it and hit "Delete this shift"
 *   mobile  → re-open the row's ShiftOverrideDialog and hit its
 *             "Delete this day's shifts" button (there is no cell popover)
 */
export async function deleteShiftOverride(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.locator('[data-testid^="shift-row-"]').first().click();
    await page
      .getByRole('button', { name: "Delete this day's shifts" })
      .click();
    return;
  }
  await page
    .getByRole('button', { name: /10:00am.*7:00pm/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Delete this shift' }).click();
}

/**
 * Open the "Edit time entry" dialog for the first timesheet row, at either
 * viewport. Same dialog (`EditTimeEntryDialog`), different chrome:
 *   desktop → the row's `⋯ Open menu` → "Edit times"
 *   mobile  → tapping the record row itself (MobileRecordRow `onClick`)
 */
export async function openEditFirstTimeEntry(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.locator('[data-testid^="time-entry-row-"]').first().click();
    return;
  }
  await page.getByRole('button', { name: 'Open menu' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit times' }).click();
}
