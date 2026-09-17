import { deleteOpenBlock, gotoSurface, isMobile } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Calendar tab — DEEP booking flows on Borradh's built-in calendar. Where
 * `calendar.spec.ts` stays broad-shallow (view routes mount, dialogs open),
 * this file drives the real create / reschedule / cancel / block surfaces end
 * to end and asserts PERSISTENCE via the API read-model (like the deposit
 * specs), then confirms the calendar reflects it. Runs under both the `tabs`
 * (desktop) and `tabs-mobile` (Pixel 7) projects off the SAME file.
 *
 * Viewport divergence (this UI is far from viewport-agnostic — the create,
 * block and appointment-detail surfaces are DIFFERENT components per viewport,
 * so several flows branch on `isMobile`, not only reschedule):
 *  - Create appointment: desktop = the header "Add appointment" dialog
 *    (`AddAppointmentDialog`); mobile = the full-page create route
 *    (`/dashboard/calendar/new?leadId&serviceId` → `AppointmentMobileCreateDetails`).
 *    Both commit through `POST /appointments` and their submit button is
 *    labelled "Create Appointment".
 *  - Appointment detail (open by tapping the event): desktop = the docked
 *    `AppointmentSidePanel` (edit date/time/staff, "Save changes", "Cancel
 *    booking"); mobile = the `MobileBookingDetailSheet` vaul drawer (inline
 *    time input commits on blur, "Cancel booking"). Both expose a "Cancel
 *    booking" control → an `alertdialog` confirm, so cancel is shared.
 *  - Reschedule: desktop edits the side-panel time + "Save changes"; mobile
 *    edits the drawer's time input (commits on blur). NOTE: the desktop calendar
 *    also supports drag-to-reschedule, but that path is react-dnd's HTML5Backend
 *    (see `dnd-provider.tsx`, MouseTransition) which Chromium drives only via
 *    TRUSTED native drag events — Playwright's synthetic mouse/`dragTo` cannot
 *    fire them, so the drivable desktop reschedule surface is the side panel.
 *  - Block off: desktop = the header "Add blocked time" dialog
 *    (`BlockedTimeDialog`); mobile = the full-page `/dashboard/calendar/new/block`
 *    route (`AppointmentMobileBlockTime`, reason-titled, default "Lunch").
 *
 * The org's own cookie-authed session seeds prerequisites + reads back state
 * (`org.seed.authenticatedApiCall`), so each test drives only its surface.
 *
 * The appointment DEPOSIT flow lives in `deposit-pay.spec.ts` /
 * `deposit-refund.spec.ts` (Stripe-stub tier) — there is no in-app deposit
 * REQUEST UI (deposits are minted via `POST /deposits`), so it can't be added
 * here as a pure UI drive; those specs cover the money transition end to end.
 */

interface Seed {
  authenticatedApiCall: (
    method: 'PATCH' | 'POST' | 'GET' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
    suppressStatuses?: number[]
  ) => Promise<unknown>;
}

/** Flip the org onto Borradh's built-in calendar so the full grid + dialogs render. */
async function enableBuiltInCalendar(seed: Seed): Promise<void> {
  await seed.authenticatedApiCall('PATCH', '/organization/active', {
    bookingDestination: 'borradh',
  });
}

/** Seed a client (lead) via the org's session; returns its id. */
async function seedClient(seed: Seed, label: string): Promise<string> {
  const lead = (await seed.authenticatedApiCall('POST', '/leads', {
    firstName: label,
  })) as { id: string };
  expect(lead.id, 'lead seed should return an id').toBeTruthy();
  return lead.id;
}

/** Seed an appointment at a fixed hour today; returns its id + title. */
async function seedAppointment(
  seed: Seed,
  leadId: string,
  startHour: number
): Promise<{ id: string; title: string; startDate: string }> {
  const title = `E2E Booking ${Date.now()}`;
  const start = new Date();
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(startHour + 1, 0, 0, 0);
  const appt = (await seed.authenticatedApiCall('POST', '/appointments', {
    title,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    leadId,
  })) as { id: string; startDate: string };
  expect(appt.id, 'appointment seed should return an id').toBeTruthy();
  return { id: appt.id, title, startDate: appt.startDate };
}

/**
 * VIEWPORT HELPERS — the create / reschedule / block surfaces are different
 * components per viewport (see the header), so the divergence lives here, in
 * named helpers OUTSIDE the test bodies. Both branches are real, asserted paths;
 * neither is a skip.
 */

/** Create an appointment through the UI. Returns the title it will render under. */
async function createAppointmentThroughUi(
  page: import('@playwright/test').Page,
  input: {
    leadId: string;
    clientName: string;
    serviceId: string;
    serviceName: string;
    notes: string;
    mobileTitle: string;
  }
): Promise<string> {
  if (isMobile(page)) {
    // Mobile: deep-link with lead+service pre-selected via search params. That
    // does NOT land on the details step — the flow still asks WHO the appointment
    // is with ("Select Team Member"), so the details form (and its Title field)
    // does not exist yet. The spec used to fill Title immediately and timed out
    // on a step it had never advanced past. Take "Any team member" — the booking
    // does not depend on a specific practitioner.
    await gotoSurface(
      page,
      `/dashboard/calendar/new?leadId=${input.leadId}&serviceId=${input.serviceId}`
    );
    await page.getByText('Any team member').click();
    await page.getByLabel('Notes').fill(input.notes);
    await page.getByRole('button', { name: 'Create Appointment' }).click();
    // Mobile does NOT ask for a title — `appointment-create-form.ts` DERIVES it
    // from the chosen service ("title — auto-derived from the chosen service
    // (never typed by the user)"). The old code filled a Title field that does
    // not exist on this surface and timed out. The calendar therefore renders
    // this booking under the SERVICE name.
    return input.serviceName;
  }

  // Desktop: the day header's "Add" split-menu → "Appointment" opens the
  // create dialog.
  await gotoSurface(page, '/dashboard/calendar/day');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appointment' }).click();

  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByRole('heading', { name: 'Create Appointment' })
  ).toBeVisible({ timeout: 20_000 });

  // Client picker (combobox → search → option).
  await dialog.getByRole('combobox', { name: 'Select client' }).click();
  await page.getByPlaceholder('Search clients...').fill(input.clientName);
  await page
    .getByRole('option', { name: new RegExp(input.clientName, 'i') })
    .first()
    .click();

  // Service select (combobox → option in a portal).
  await dialog.getByRole('combobox', { name: 'Service' }).click();
  await page
    .getByRole('option', { name: new RegExp(input.serviceName, 'i') })
    .click();

  await dialog.getByRole('textbox', { name: 'Notes' }).fill(input.notes);
  await dialog.getByRole('button', { name: 'Create Appointment' }).click();

  // Dialog closes on success.
  await expect(
    page.getByRole('heading', { name: 'Create Appointment' })
  ).toBeHidden({ timeout: 20_000 });

  // Desktop titles the appointment from the service.
  return input.serviceName;
}

/** Move the open appointment's start time to `hhmm` on whichever detail surface rendered. */
async function rescheduleThroughUi(
  page: import('@playwright/test').Page,
  hhmm: string
): Promise<void> {
  // ONE path for both viewports. Desktop's AppointmentSidePanel and mobile's
  // MobileBookingDetailSheet both compose the SAME `AppointmentEditFields`
  // (a labelled `<input type="time">`) and both commit through an explicit
  // "Save changes" submit.
  //
  // The mobile branch used to fill a raw `input[type=time]` and Tab out,
  // believing the drawer "commits on blur". It does not — the sheet has a Save
  // button — so the edit was simply dropped and the appointment never moved,
  // which is why the persistence assertion saw the ORIGINAL start time.
  const startTime = page.getByLabel('Start time');
  await startTime.waitFor({ state: 'visible', timeout: 20_000 });
  await startTime.fill(hhmm);
  // The submit is "Save changes" in the desktop side panel and "Save" in the
  // mobile sheet. Anchored so it can't also catch "Save Block".
  await page.getByRole('button', { name: /^Save( changes)?$/ }).click();
}

/** Create a blocked time through the UI. Returns the title it will render under. */
async function createBlockThroughUi(
  page: import('@playwright/test').Page,
  desktopTitle: string
): Promise<string> {
  if (isMobile(page)) {
    // Mobile: the full-page block route.
    //
    // The defaults are NOT sufficient. Type defaults to "Custom", which REQUIRES
    // a title — leaving it empty just renders "Title is required" and the form
    // never submits (no POST at all), so the block silently never existed and the
    // test failed later looking for it on the agenda. This used to assume the
    // defaults were valid and that the block would be titled from a "Lunch"
    // reason preset; neither is true.
    //
    // Fill the SAME title desktop uses, so both viewports create the same block
    // and every assertion downstream is shared.
    await gotoSurface(page, '/dashboard/calendar/new/block');
    await page.getByLabel('Title').fill(desktopTitle);
    await page.getByRole('button', { name: 'Save Block' }).click();
    return desktopTitle;
  }

  // Desktop: the day header's "Add" split-menu → "Blocked time" opens the
  // blocked-time dialog.
  await gotoSurface(page, '/dashboard/calendar/day');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blocked time' }).click();

  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByRole('heading', { name: 'Add blocked time' })
  ).toBeVisible({ timeout: 20_000 });
  await dialog.getByLabel('Title').fill(desktopTitle);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('heading', { name: 'Add blocked time' })
  ).toBeHidden({ timeout: 20_000 });
  return desktopTitle;
}

/** Normalize the list-appointments response (array or `{ items }`). */
function toItems(res: unknown): Array<{
  id: string;
  title: string;
  serviceId?: string | null;
  description?: string | null;
}> {
  if (Array.isArray(res)) return res as never;
  const items = (res as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as never) : [];
}

test.describe('Calendar · booking flows (built-in calendar)', () => {
  // ── CREATE ────────────────────────────────────────────────────────────────
  test('create an appointment through the UI; it persists and renders', async ({
    org,
  }) => {
    const { page, seed } = org;
    await enableBuiltInCalendar(seed);

    // Prerequisites: a service, a practitioner (assigned to the service), and a
    // client to book — all via the real authenticated API.
    const clientName = `E2E Client ${Date.now()}`;
    const service = await seed.createService({
      name: `E2E Service ${Date.now()}`,
      appointmentDuration: 60,
      priceText: '€50',
      priceCents: 5000,
    });
    const practitioner = await seed.createPractitioner({
      name: `E2E Pro ${Date.now()}`,
      email: `e2e.pro.${Date.now()}@example.com`,
    });
    await seed.assignPractitionerServices(practitioner.id, [service.id]);
    const leadId = await seedClient(seed, clientName);

    const notes = `Booked by E2E ${Date.now()}`;
    const expectedTitle = await createAppointmentThroughUi(page, {
      leadId,
      clientName,
      serviceId: service.id,
      serviceName: service.name,
      notes,
      mobileTitle: `E2E Mobile Appt ${Date.now()}`,
    });

    // Persistence: the appointment exists for this client with the service +
    // notes it was created with.
    await expect
      .poll(
        async () => {
          const res = await seed.authenticatedApiCall(
            'GET',
            `/appointments?leadId=${leadId}&limit=50`
          );
          return toItems(res);
        },
        { timeout: 20_000 }
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: expectedTitle,
            serviceId: service.id,
            description: notes,
          }),
        ])
      );

    // UI render: the agenda lists it (viewport-agnostic surface).
    await gotoSurface(page, '/dashboard/calendar/agenda');
    await expect(page.getByText(expectedTitle).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // ── RESCHEDULE ──────────────────────────────────────────────────────────
  test('reschedule an appointment; the new time persists', async ({ org }) => {
    const { page, seed } = org;
    await enableBuiltInCalendar(seed);

    const leadId = await seedClient(seed, `E2E Client ${Date.now()}`);
    const appt = await seedAppointment(seed, leadId, 10);
    const before = new Date(appt.startDate).getTime();

    await gotoSurface(page, '/dashboard/calendar/agenda');
    await page.getByText(appt.title).first().click();

    await rescheduleThroughUi(page, '15:00');

    // Persistence: the stored start moved. The org's timezone defaults to UTC
    // (created via the testing API), and the edit forms treat the picked
    // wall-clock as business-tz → 15:00 lands on UTC hour 15.
    await expect
      .poll(
        async () => {
          const row = (await seed.authenticatedApiCall(
            'GET',
            `/appointments/${appt.id}`
          )) as { startDate?: string };
          return row.startDate ? new Date(row.startDate).getTime() : before;
        },
        { timeout: 20_000 }
      )
      .not.toBe(before);

    const row = (await seed.authenticatedApiCall(
      'GET',
      `/appointments/${appt.id}`
    )) as { startDate: string };
    expect(new Date(row.startDate).getUTCHours()).toBe(15);

    // UI: the calendar RENDERS the booking at its new time. The agenda card
    // (`AgendaEventCard`, the same component at both viewports) prints the
    // start/end as `h:mm a` in the org timezone (UTC here) — so the rescheduled
    // 15:00 start must read "3:00 PM" on the card carrying this appointment's
    // title. Without this, a calendar that stopped reflecting the new time
    // would still pass on the API read alone.
    await gotoSurface(page, '/dashboard/calendar/agenda');
    const card = page
      .locator('[role="button"]')
      .filter({ hasText: appt.title })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('3:00 PM', { timeout: 20_000 });
  });

  // ── CANCEL ────────────────────────────────────────────────────────────────
  test('cancel an appointment; it is removed from the calendar', async ({
    org,
  }) => {
    const { page, seed } = org;
    await enableBuiltInCalendar(seed);

    const leadId = await seedClient(seed, `E2E Client ${Date.now()}`);
    const appt = await seedAppointment(seed, leadId, 11);

    await gotoSurface(page, '/dashboard/calendar/agenda');
    await page.getByText(appt.title).first().click();

    // Both surfaces expose a "Cancel booking" trigger → alertdialog confirm.
    await page.getByRole('button', { name: 'Cancel booking' }).first().click();
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor({ state: 'visible', timeout: 15_000 });
    await confirm.getByRole('button', { name: 'Cancel booking' }).click();

    // Persistence: the appointment is deleted (GET no longer returns a row for
    // this id — the response carries no matching startDate/id).
    await expect
      .poll(
        async () => {
          const row = (await seed.authenticatedApiCall(
            'GET',
            `/appointments/${appt.id}`,
            undefined,
            [404]
          )) as { id?: string };
          return row?.id === appt.id;
        },
        { timeout: 20_000 }
      )
      .toBe(false);

    // UI: the booking is gone from the agenda.
    await gotoSurface(page, '/dashboard/calendar/agenda');
    await expect(page.getByText(appt.title)).toBeHidden({ timeout: 20_000 });
  });

  // ── BLOCK OFF ───────────────────────────────────────────────────────────
  test('block off time through the UI, then delete it', async ({ org }) => {
    const { page, seed } = org;
    await enableBuiltInCalendar(seed);

    // Desktop lets us name the block; the mobile flow titles it from the reason
    // preset (default "Lunch").
    const expectedTitle = await createBlockThroughUi(
      page,
      `E2E Block ${Date.now()}`
    );

    // The block renders on the agenda (viewport-agnostic surface).
    await gotoSurface(page, '/dashboard/calendar/agenda');
    const block = page.getByText(expectedTitle).first();
    await expect(block).toBeVisible({ timeout: 30_000 });

    // Delete it via the detail surface. A block is NOT an appointment: the
    // calendar offers "Cancel booking" for appointments and a DELETE for blocks
    // (desktop: `Delete`; mobile: `Delete block` -> confirm). This used to click
    // "Cancel booking" on a block at both viewports — a control that does not
    // exist on that surface — so it could never pass.
    await block.click();
    await deleteOpenBlock(page);

    // The block is gone from the calendar.
    await gotoSurface(page, '/dashboard/calendar/agenda');
    await expect(page.getByText(expectedTitle)).toBeHidden({ timeout: 20_000 });
  });
});
