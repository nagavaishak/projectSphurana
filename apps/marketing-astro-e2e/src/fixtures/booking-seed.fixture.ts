/**
 * Staff-side seeding for the BOOKING specs, on their new home.
 *
 * The booking flow moved out of `apps/app` and onto the microsite, so these
 * specs moved with it — same reason the portal specs did. In app-e2e they
 * seeded through `SeedHelper`, which is built around a signed-in browser
 * `page`; here the staff side is pure HTTP via `PortalSeed`, and the visitor
 * side is genuinely anonymous because this suite carries no storageState at
 * all. (In app-e2e each test had to open `browser.newContext({ storageState:
 * undefined })` to shed the bare-user session before it could act like a
 * customer. Nothing to shed here.)
 *
 * These are thin wrappers over `PortalSeed.call`, kept together so a spec
 * reads as booking setup rather than a column of URL strings — and so the
 * assertions that catch a silently-dropped field live in ONE place.
 */
import { expect } from '@playwright/test';
import type { PortalSeed } from './portal-seed.fixture.js';

/** 09:00–18:00 (minutes from midnight), every day. Keys are `Date#getDay()`. */
export const ALL_WEEK_WORKING_HOURS = {
  0: { from: 540, to: 1080 },
  1: { from: 540, to: 1080 },
  2: { from: 540, to: 1080 },
  3: { from: 540, to: 1080 },
  4: { from: 540, to: 1080 },
  5: { from: 540, to: 1080 },
  6: { from: 540, to: 1080 },
};

export interface SeededService {
  id: string;
  name: string;
  category: string | null;
  appointmentDuration: number | null;
  priceText: string | null;
}

/**
 * Create an organization service and assert the row came back with what we
 * sent.
 *
 * Field names MUST match `createServiceSchema`: the bookable length is
 * `appointmentDuration` (minutes), not `duration`, and there is no numeric
 * `price` column. A `{ duration, price }` payload used to be silently stripped
 * by the DTO's zod parse, so a "60-minute service" persisted a null duration
 * and no test noticed. Hence the round-trip assertions.
 *
 * PRICING: `priceText` is DISPLAY ONLY — the API never parses it, and price
 * type is inferred from `priceCents` (absent → POA/€0). If a spec asserts on a
 * cart total or a sale amount it MUST pass `priceCents`; `priceText` alone
 * leaves the service at €0 and the failure surfaces far away.
 */
export async function createService(
  seed: PortalSeed,
  data: {
    name: string;
    category?: string;
    appointmentDuration?: number;
    priceText?: string;
    priceCents?: number;
  }
): Promise<SeededService> {
  const created = await seed.call<SeededService>(
    'POST',
    '/organization-services',
    { priceText: '€50 per session', ...data }
  );

  expect(
    created.id,
    `createService did not return a row: ${JSON.stringify(created)}`
  ).toBeTruthy();
  expect(created.name).toBe(data.name);
  if (data.appointmentDuration !== undefined) {
    expect(
      created.appointmentDuration,
      'appointmentDuration was not persisted — did the seed send a key the schema strips?'
    ).toBe(data.appointmentDuration);
  }
  return created;
}

/**
 * Add an OPTIONAL pricing variant. A service that owns variants forces the
 * wizard to open a chooser so the customer picks exactly one, and the chosen
 * variant's name/price/duration are snapshotted onto the appointment.
 */
export async function createServiceVariant(
  seed: PortalSeed,
  serviceId: string,
  data: {
    name: string;
    priceCents?: number | null;
    durationMinutes?: number | null;
    sortOrder?: number;
  }
): Promise<{ id: string; name: string; priceCents: number | null }> {
  const created = await seed.call<{
    id: string;
    name: string;
    priceCents: number | null;
  }>('POST', `/organization-services/${serviceId}/variants`, data);
  expect(
    created.id,
    `createServiceVariant did not return a row: ${JSON.stringify(created)}`
  ).toBeTruthy();
  expect(created.name).toBe(data.name);
  return created;
}

/**
 * A practitioner who can actually be booked: assigned to the given services
 * and covered by seven-day shifts.
 *
 * Availability is derived SOLELY from `shift` rows — `resolveAvailability` has
 * no working-hours fallback — and create-practitioner seeds only a Mon–Fri
 * default. A spec targeting "a week from today" therefore found zero slots
 * whenever CI ran at the weekend. Seeding all seven days makes slots
 * guaranteed on any date the picker can land on.
 */
export async function createBookablePractitioner(
  seed: PortalSeed,
  input: { name: string; email: string; serviceIds: string[] }
): Promise<{ id: string }> {
  const practitioner = await seed.call<{ id?: string }>(
    'POST',
    '/practitioners',
    {
      name: input.name,
      email: input.email,
      workingHours: ALL_WEEK_WORKING_HOURS,
    }
  );
  if (!practitioner?.id) {
    throw new Error(
      `Failed to seed practitioner: ${JSON.stringify(practitioner)}`
    );
  }

  await seed.call('PUT', `/practitioners/${practitioner.id}/services`, {
    serviceIds: input.serviceIds,
  });

  const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    intervals: [{ startMinutes: 540, endMinutes: 1080 }],
  }));
  const shifts = await seed.call('PUT', `/shifts/weekly/${practitioner.id}`, {
    days,
  });
  if (!Array.isArray(shifts)) {
    throw new Error(
      `setWeeklyShifts(${practitioner.id}) did not return shift rows: ${JSON.stringify(shifts)}`
    );
  }

  return { id: practitioner.id };
}

/**
 * The nearest weekday at least `minDaysAhead` out, formatted like the date
 * strip's `EEEE d MMMM` labels (e.g. "Tuesday 22 July").
 *
 * WHY A WEEKDAY, not just today+N: the public slots resolver applies hours in
 * the order location → practitioner → org. The org's LOCATION opening hours
 * win outright when set, and they only cover Mon–Fri — so a weekend date shows
 * "No available times" no matter what the seeded practitioner's hours say.
 */
export function nearFutureWeekdayLabel(minDaysAhead = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Where the booking flow lives now: under the microsite base. */
export const bookingPath = (slug: string, subpath = ''): string =>
  `/sites/${encodeURIComponent(slug)}/book${subpath}`;
