import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';
import type { SeedHelper } from '../fixtures/seed.fixture.js';

/**
 * Calendar tab — the calendar's DAY is the ORGANIZATION's day, not the
 * viewer's.
 *
 * This is the end-to-end half of `apps/app/src/components/calendar/
 * day-bucketing.test.ts`. The unit tests pin the pure helpers
 * (`getViewRange`, `getEventsCount`, `zonedStartOfDayUtc`); these drive the
 * real browser, in a real viewer timezone, against a real org in a DIFFERENT
 * timezone — the configuration that produced the original defect and that no
 * unit test can reproduce, because the runner pins `TZ: 'UTC'`.
 *
 * The setup every test here shares:
 *
 *   org timezone    America/Los_Angeles   (seeded via its primary location)
 *   viewer timezone Europe/Dublin         (`test.use({ timezoneId })`)
 *
 * Dublin is 7–8 hours AHEAD of Los Angeles all year round, so an ordinary
 * late-afternoon LA booking is already TOMORROW for the operator's browser:
 *
 *   LA 6:00 PM on the 20th  =  2026-08-21T01:00:00Z  =  Dublin 02:00 on the 21st
 *
 * Every assertion below turns on exactly that. A calendar that buckets by the
 * viewer's clock files the booking under the wrong day — which is what an
 * operator in Dublin administering an LA salon actually saw: an empty grid
 * while the API had returned every row.
 *
 * DESKTOP ONLY. Two of the four surfaces asserted here (the header's event
 * count badge, the hover-to-create slot) do not exist at the mobile viewport —
 * `ClientContainer` renders `CalendarHeader` only when `!isMobile`, and the
 * mobile create flow is a route, not a slot. The bucketing itself is shared
 * (same `ClientContainer`, same helpers), so it is covered once, here. This is
 * an ENVIRONMENT gate — the project's device descriptor, known before the
 * browser opens — not a skip on anything the app did.
 */

const ORG_TZ = 'America/Los_Angeles';
const VIEWER_TZ = 'Europe/Dublin';

/** Downtown Los Angeles — `timezoneForLocation` resolves these to `ORG_TZ`. */
const LA_LOCATION = {
  addressLine1: '350 S Grand Ave',
  city: 'Los Angeles',
  country: 'us' as const,
  latitude: 34.0522,
  longitude: -118.2437,
  isPrimary: true,
};

// ─── Timezone arithmetic (no dependency on the runner's own TZ) ────────────
//
// Written out rather than pulled from date-fns so these helpers are obviously
// independent of the code under test: a bug shared between the app's timezone
// helpers and the test's would cancel out and the spec would pass on a broken
// calendar.

/** Milliseconds `tz`'s wall clock is ahead of UTC at `instant`. */
function zoneOffsetMs(tz: string, instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // `hour12: false` renders midnight as "24" in some ICU versions.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - instant.getTime();
}

/** The UTC instant of a wall-clock `YYYY-MM-DD` + `HH:mm` in `tz`. */
function zonedWallTimeToUtc(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes: the first offset is read at the wrong instant near a DST edge,
  // the second at (very nearly) the right one.
  const first = naive - zoneOffsetMs(tz, new Date(naive));
  return new Date(naive - zoneOffsetMs(tz, new Date(first)));
}

/** The calendar date (`YYYY-MM-DD`) an instant falls on in `tz`. */
function zonedDateString(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** `2026-08-21` → `Friday, August 21, 2026` (the agenda group heading). */
function agendaHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `2026-08-21` → `Fri, Aug 21` (the day view's header date button). */
function dayHeaderLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `2026-08-21` + 1 → `2026-08-22`. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return zonedDateString(new Date(Date.UTC(y, m - 1, d + days)), 'UTC');
}

// ─── Seeding ──────────────────────────────────────────────────────────────

/** Flip the org onto Borradh's built-in calendar so the full grid renders. */
async function enableBuiltInCalendar(seed: SeedHelper): Promise<void> {
  await seed.authenticatedApiCall('PATCH', '/organization/active', {
    bookingDestination: 'borradh',
  });
}

/**
 * Put the org in Los Angeles and PROVE it took.
 *
 * `organization.timezone` has no direct setter — it is DERIVED from the primary
 * location's geography (`createLocation` → `syncOrganizationTimezone`), which
 * is the real product path an operator goes through. A fresh org is still on
 * the `'UTC'` column default, so the sync writes rather than declining.
 *
 * The poll is the precondition being SEEDED, not observed: if the org never
 * reaches `America/Los_Angeles` this fails here, loudly, instead of every
 * assertion downstream quietly degenerating into a UTC-vs-UTC tautology.
 */
async function putOrgInLosAngeles(seed: SeedHelper): Promise<void> {
  await seed.authenticatedApiCall(
    'POST',
    '/organization-locations',
    LA_LOCATION
  );

  await expect
    .poll(
      async () => {
        const org = (await seed.authenticatedApiCall(
          'GET',
          '/organization/active'
        )) as { timezone?: string };
        return org?.timezone;
      },
      {
        timeout: 20_000,
        message:
          'the org must be in America/Los_Angeles for this spec to discriminate',
      }
    )
    .toBe(ORG_TZ);
}

/** A client to book. */
async function seedClient(seed: SeedHelper, label: string): Promise<string> {
  const lead = (await seed.authenticatedApiCall('POST', '/leads', {
    firstName: label,
  })) as { id: string };
  expect(lead.id, 'lead seed should return an id').toBeTruthy();
  return lead.id;
}

/**
 * An appointment at a wall-clock time IN THE ORG'S ZONE. `hhmm` is what the
 * salon in Los Angeles would call it; the stored value is the instant.
 */
async function seedAppointmentAtOrgTime(
  seed: SeedHelper,
  input: {
    leadId: string;
    practitionerId: string;
    orgDate: string;
    orgTime: string;
    durationMinutes?: number;
  }
): Promise<{ id: string; title: string; startDate: Date }> {
  const title = `E2E TZ ${input.orgTime} ${Date.now()}`;
  const startDate = zonedWallTimeToUtc(input.orgDate, input.orgTime, ORG_TZ);
  const endDate = new Date(
    startDate.getTime() + (input.durationMinutes ?? 60) * 60_000
  );

  const appt = (await seed.authenticatedApiCall('POST', '/appointments', {
    title,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    leadId: input.leadId,
    practitionerId: input.practitionerId,
  })) as { id: string };
  expect(appt.id, 'appointment seed should return an id').toBeTruthy();
  return { id: appt.id, title, startDate };
}

/**
 * The full LA-org / Dublin-viewer stage, plus the prerequisites every test
 * needs: a practitioner (the day grid renders one column per team member and
 * routes events by `practitionerId`), a service, and a client.
 */
async function stageLosAngelesOrg(seed: SeedHelper) {
  await enableBuiltInCalendar(seed);
  await putOrgInLosAngeles(seed);

  const stamp = Date.now();
  const service = await seed.createService({
    name: `E2E TZ Service ${stamp}`,
    appointmentDuration: 60,
    priceText: '€50',
    priceCents: 5000,
  });
  const practitioner = await seed.createPractitioner({
    name: `E2E TZ Pro ${stamp}`,
    email: `e2e.tz.pro.${stamp}@example.com`,
  });
  await seed.assignPractitionerServices(practitioner.id, [service.id]);
  const clientName = `E2E TZ Client ${stamp}`;
  const leadId = await seedClient(seed, clientName);

  // The calendar opens on the VIEWER's today (`selectedDate = new Date()` in
  // the browser), so that is the day the org's bookings must land on for the
  // grid to show them without navigation.
  const viewerToday = zonedDateString(new Date(), VIEWER_TZ);

  return { service, practitioner, clientName, leadId, viewerToday };
}

/** The persisted start instant of an appointment, via the read model. */
async function persistedStart(
  seed: SeedHelper,
  appointmentId: string
): Promise<Date> {
  const row = (await seed.authenticatedApiCall(
    'GET',
    `/appointments/${appointmentId}`
  )) as { startDate: string };
  return new Date(row.startDate);
}

/** The one appointment this org has, whatever the UI titled it. */
async function onlyAppointment(
  seed: SeedHelper,
  leadId: string
): Promise<{ id: string; title: string; startDate: string }> {
  const res = (await seed.authenticatedApiCall(
    'GET',
    `/appointments?leadId=${leadId}&limit=50`
  )) as unknown;
  const items = (
    Array.isArray(res) ? res : ((res as { items?: unknown }).items ?? [])
  ) as Array<{ id: string; title: string; startDate: string }>;
  expect(
    items,
    'exactly one appointment should exist for this client'
  ).toHaveLength(1);
  return items[0];
}

// ─── Shared UI drivers ────────────────────────────────────────────────────

/**
 * Fill and submit the desktop create dialog, which is already open. The client,
 * service and team member are chosen for real; `orgTime` goes into the "Start
 * time" control as the wall-clock the OPERATOR types — the whole question this
 * spec asks is which zone that gets resolved in.
 */
async function submitCreateDialog(
  page: import('@playwright/test').Page,
  input: {
    clientName: string;
    serviceName: string;
    practitionerName: string;
    orgTime?: string;
  }
): Promise<void> {
  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByRole('heading', { name: 'Create Appointment' })
  ).toBeVisible({ timeout: 20_000 });

  await dialog.getByRole('combobox', { name: 'Select client' }).click();
  await page.getByPlaceholder('Search clients...').fill(input.clientName);
  await page
    .getByRole('option', { name: new RegExp(input.clientName, 'i') })
    .first()
    .click();

  await dialog.getByRole('combobox', { name: 'Service' }).click();
  await page
    .getByRole('option', { name: new RegExp(input.serviceName, 'i') })
    .click();

  await dialog.getByRole('combobox', { name: 'Team member' }).click();
  await page
    .getByRole('option', { name: new RegExp(input.practitionerName, 'i') })
    .click();

  if (input.orgTime) {
    await dialog.getByLabel('Start time').fill(input.orgTime);
  }

  await dialog.getByRole('button', { name: 'Create Appointment' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create Appointment' })
  ).toBeHidden({ timeout: 20_000 });
}

test.use({ timezoneId: VIEWER_TZ });

test.describe("Calendar · the day is the org's, not the viewer's", () => {
  // Environment gate: the mobile project renders neither the header count badge
  // nor the hover-create slot (see the file header).
  test.skip(
    ({ isMobile }) => !!isMobile,
    'Desktop surfaces: the calendar header controls and the hover-create slot.'
  );

  // ── READ: bucketing ──────────────────────────────────────────────────────
  test('an LA evening booking shows on the org day the viewer already calls tomorrow', async ({
    org,
  }) => {
    const { page, seed } = org;
    const { practitioner, leadId, viewerToday } =
      await stageLosAngelesOrg(seed);

    // 6:00 PM in Los Angeles — 01:00/02:00 the NEXT day in Dublin. Bucketed by
    // the viewer's clock this booking is filed under tomorrow and the grid for
    // today comes back empty.
    const appt = await seedAppointmentAtOrgTime(seed, {
      leadId,
      practitionerId: practitioner.id,
      orgDate: viewerToday,
      orgTime: '18:00',
    });
    expect(
      zonedDateString(appt.startDate, VIEWER_TZ),
      'the seeded instant must fall on a DIFFERENT viewer day, or this test proves nothing'
    ).toBe(addDays(viewerToday, 1));

    await gotoSurface(page, '/dashboard/calendar/day');

    // The grid renders it, on the day the salon calls today.
    await expect(page.getByText(appt.title).first()).toBeVisible({
      timeout: 30_000,
    });

    // …on the day the header says it is showing. The header, the grid's own
    // day filter and `getViewRange` all have to name the same day for this to
    // hold; bucketing by the browser would have the header on the org's date
    // and the booking on the next one.
    await expect(
      page.getByRole('button', { name: dayHeaderLabel(viewerToday) })
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the agenda groups an LA evening booking under the org day and prints the org time', async ({
    org,
  }) => {
    const { page, seed } = org;
    const { practitioner, leadId, viewerToday } =
      await stageLosAngelesOrg(seed);

    const appt = await seedAppointmentAtOrgTime(seed, {
      leadId,
      practitionerId: practitioner.id,
      orgDate: viewerToday,
      orgTime: '18:00',
    });

    await gotoSurface(page, '/dashboard/calendar/agenda');
    await expect(page.getByText(appt.title).first()).toBeVisible({
      timeout: 30_000,
    });

    // This org has exactly one appointment, so exactly one day group exists.
    // It must be headed with the LA date, and the viewer's date must not
    // appear at all — grouping by the browser's clock produces the latter.
    await expect(page.getByText(agendaHeading(viewerToday))).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(agendaHeading(addDays(viewerToday, 1)))
    ).toBeHidden();

    // The card prints the salon's wall clock, not Dublin's.
    const card = page
      .locator('[role="button"]')
      .filter({ hasText: appt.title })
      .first();
    await expect(card).toContainText('6:00 PM', { timeout: 20_000 });
  });

  test('a booking at the very end of the org day stays on that day, not the next', async ({
    org,
  }) => {
    const { page, seed } = org;
    const { practitioner, leadId, viewerToday } =
      await stageLosAngelesOrg(seed);

    // 11:00 PM–11:59 PM in LA: the last hour of the salon's day, and already
    // mid-morning tomorrow in Dublin. It belongs to today's grid and must be
    // absent from tomorrow's — the half-open `[start, end)` window means a day
    // boundary is owned by exactly one day.
    const appt = await seedAppointmentAtOrgTime(seed, {
      leadId,
      practitionerId: practitioner.id,
      orgDate: viewerToday,
      orgTime: '23:00',
      durationMinutes: 59,
    });
    expect(zonedDateString(appt.startDate, VIEWER_TZ)).toBe(
      addDays(viewerToday, 1)
    );

    await gotoSurface(page, '/dashboard/calendar/day');
    await expect(page.getByText(appt.title).first()).toBeVisible({
      timeout: 30_000,
    });

    // Step the day view forward one day — the org's next day, which this
    // booking does NOT belong to even though the viewer's clock puts it there.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: dayHeaderLabel(addDays(viewerToday, 1)),
      })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(appt.title)).toBeHidden({ timeout: 20_000 });
  });

  // ── WRITE: creating from the calendar ────────────────────────────────────
  test('the "Add" button books the time the operator typed as the ORG\'s wall clock', async ({
    org,
  }) => {
    const { page, seed } = org;
    const { service, practitioner, clientName, leadId, viewerToday } =
      await stageLosAngelesOrg(seed);

    await gotoSurface(page, '/dashboard/calendar/day');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Appointment' }).click();

    await submitCreateDialog(page, {
      clientName,
      serviceName: service.name,
      practitionerName: practitioner.name,
      orgTime: '18:00',
    });

    // Persistence: 6:00 PM meant 6:00 PM IN LOS ANGELES. Resolved against the
    // viewer's Dublin clock instead, the same "18:00" would have been stored
    // 7–8 hours early.
    const created = await onlyAppointment(seed, leadId);
    const expected = zonedWallTimeToUtc(viewerToday, '18:00', ORG_TZ);
    expect((await persistedStart(seed, created.id)).getTime()).toBe(
      expected.getTime()
    );
    expect(
      zonedWallTimeToUtc(viewerToday, '18:00', VIEWER_TZ).getTime()
    ).not.toBe(expected.getTime());

    // …and the calendar it was created from shows it, on the org's today.
    await gotoSurface(page, '/dashboard/calendar/day');
    await expect(page.getByText(created.title).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('button', { name: dayHeaderLabel(viewerToday) })
    ).toBeVisible({ timeout: 20_000 });
  });

  test("clicking a slot on the grid books THAT slot, in the org's wall clock", async ({
    org,
  }) => {
    const { page, seed } = org;
    const { service, practitioner, clientName, leadId, viewerToday } =
      await stageLosAngelesOrg(seed);

    await gotoSurface(page, '/dashboard/calendar/day');

    // The grid's slots are labelled in the BUSINESS zone (the hours rail reads
    // `HH:mm` of the org's day), so clicking 10:15 is the operator saying
    // "quarter past ten, salon time".
    const slot = page.locator('[data-slot-time="10:15"]').first();
    await expect(slot).toBeAttached({ timeout: 30_000 });
    await slot.click();

    // The dialog opens pre-seeded from the slot. That prefill is the claim
    // under test on this surface: the slot's own time, unshifted.
    const dialog = page.locator('[role="dialog"]');
    await expect(
      dialog.getByRole('heading', { name: 'Create Appointment' })
    ).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByLabel('Start time')).toHaveValue('10:15');

    // Submit WITHOUT touching the time — the slot's value is what gets booked.
    await submitCreateDialog(page, {
      clientName,
      serviceName: service.name,
      practitionerName: practitioner.name,
    });

    const created = await onlyAppointment(seed, leadId);
    const expected = zonedWallTimeToUtc(viewerToday, '10:15', ORG_TZ);
    expect((await persistedStart(seed, created.id)).getTime()).toBe(
      expected.getTime()
    );

    // It renders back into the slot it was created from.
    await gotoSurface(page, '/dashboard/calendar/day');
    await expect(page.getByText(created.title).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
