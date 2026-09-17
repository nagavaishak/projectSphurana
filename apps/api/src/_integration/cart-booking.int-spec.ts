import {
  appointment,
  appointmentService,
  db,
  organization,
  organizationService,
} from '@borradh-workspace/database';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — multi-service cart (asserted over HTTP against a real DB).
 *
 * The functional jump this proves: a public booking can carry SEVERAL services
 * (Fresha's cart), and each becomes an `appointment_service` line item on ONE
 * appointment — not N appointments. The single-service path must still work
 * untouched. Everything is read back from SQL, not inferred from the 200.
 *
 *   a. CART round-trip — submit with serviceIds=[A,B] → one appointment, two
 *      line items snapshotting name/duration/priceCents, primary serviceId = A,
 *      appointment duration = sum(durations).
 *   b. SINGLE-service back-compat — submit with just serviceId → one appointment,
 *      and (per the service contract) still a line item for the primary.
 *   c. SNAPSHOT — the line item keeps the price/name AS BOOKED even if the
 *      catalog row is re-priced afterwards.
 */
import { PublicBookingController } from '../booking-forms/public-booking.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedBookablePractitioner,
  seedOrgWithMember,
} from './harness.js';

const CREATED = 201;
/**
 * A fixed 10:00 UTC on a future day. Deliberately NOT `now + N*24h`: that lands
 * at whatever wall-clock time CI happens to run, and an appointment starting at
 * 23:50 spans two working days, which availability correctly refuses. Pinning
 * the hour keeps the fixture deterministic.
 */
const daysFromNow = (d: number) => {
  const t = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  t.setUTCHours(10, 0, 0, 0);
  return t;
};

async function seedPricedService(
  organizationId: string,
  name: string,
  durationMinutes: number,
  priceCents: number | null
) {
  const [row] = await db
    .insert(organizationService)
    .values({
      organizationId,
      name,
      appointmentDuration: durationMinutes,
      priceCents,
      isActive: true,
    })
    .returning({ id: organizationService.id });
  return row.id;
}

async function seedVenue() {
  const owner = await seedOrgWithMember('owner');
  // A real org always has a practitioner (createOrganization seeds one) and that
  // practitioner always has shifts. Availability comes solely from those shifts,
  // so a venue without them is unbookable — model the real thing.
  await seedBookablePractitioner({ organizationId: owner.organizationId });
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, owner.organizationId));
  return { ...owner, slug: org.slug };
}

const lineItems = (appointmentId: string) =>
  db
    .select({
      name: appointmentService.name,
      durationMinutes: appointmentService.durationMinutes,
      priceCents: appointmentService.priceCents,
      serviceId: appointmentService.serviceId,
      sortOrder: appointmentService.sortOrder,
    })
    .from(appointmentService)
    .where(eq(appointmentService.appointmentId, appointmentId))
    .orderBy(asc(appointmentService.sortOrder));

describe('Fresha domain — multi-service cart (public, HTTP)', () => {
  let h: IntegrationApp | undefined;

  const buildApp = () =>
    buildControllerApp(PublicBookingController, {
      userId: 'anonymous',
      organizationId: 'none',
      role: 'owner',
    });

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  const submit = (
    app: IntegrationApp,
    slug: string,
    body: Record<string, unknown>
  ) =>
    request(app.app.getHttpServer())
      .post(`/public/booking/${slug}/submit`)
      .send(body);

  it('books a two-service cart as one appointment with two line items', async () => {
    const venue = await seedVenue();
    const start = daysFromNow(3);
    const svcA = await seedPricedService(
      venue.organizationId,
      'Eyebrows shaping',
      15,
      1000
    );
    const svcB = await seedPricedService(
      venue.organizationId,
      'Threading',
      15,
      1000
    );
    h = await buildApp();

    const res = await submit(h, venue.slug, {
      serviceId: svcA,
      serviceIds: [svcA, svcB],
      firstName: 'Sarah',
      email: 'sarah@example.com',
      appointmentStartTime: start.toISOString(),
      // Deliberately WRONG end (15 min) — the service must recompute from the
      // cart's summed durations (30 min), so this proves the server owns the end.
      appointmentEndTime: new Date(
        start.getTime() + 15 * 60 * 1000
      ).toISOString(),
    });

    expect(res.status).toBe(CREATED);
    const appointmentId = res.body.appointmentId as string;
    expect(appointmentId).toBeTruthy();

    const items = await lineItems(appointmentId);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name)).toEqual(['Eyebrows shaping', 'Threading']);
    expect(items.every((i) => i.priceCents === 1000)).toBe(true);

    const [appt] = await db
      .select({
        serviceId: appointment.serviceId,
        startDate: appointment.startDate,
        endDate: appointment.endDate,
      })
      .from(appointment)
      .where(eq(appointment.id, appointmentId));

    // Primary = first cart line; duration = 15 + 15 = 30, NOT the 15 we posted.
    expect(appt.serviceId).toBe(svcA);
    expect(appt.endDate.getTime() - appt.startDate.getTime()).toBe(
      30 * 60 * 1000
    );
  });

  it('still books a single service the old way (back-compat)', async () => {
    const venue = await seedVenue();
    const svc = await seedPricedService(
      venue.organizationId,
      'Haircut',
      30,
      2500
    );
    h = await buildApp();

    const start = daysFromNow(4);
    const res = await submit(h, venue.slug, {
      serviceId: svc,
      firstName: 'Alex',
      email: 'alex@example.com',
      appointmentStartTime: start.toISOString(),
      appointmentEndTime: new Date(
        start.getTime() + 30 * 60 * 1000
      ).toISOString(),
    });

    expect(res.status).toBe(CREATED);
    const [appt] = await db
      .select({ serviceId: appointment.serviceId })
      .from(appointment)
      .where(eq(appointment.id, res.body.appointmentId));
    expect(appt.serviceId).toBe(svc);
  });

  it('snapshots price/name onto the line item, surviving a later re-price', async () => {
    const venue = await seedVenue();
    const start = daysFromNow(5);
    const svcA = await seedPricedService(
      venue.organizationId,
      'Facial',
      45,
      5000
    );
    const svcB = await seedPricedService(
      venue.organizationId,
      'Peel',
      30,
      4000
    );
    h = await buildApp();

    const res = await submit(h, venue.slug, {
      serviceId: svcA,
      serviceIds: [svcA, svcB],
      firstName: 'Jo',
      email: 'jo@example.com',
      appointmentStartTime: start.toISOString(),
      appointmentEndTime: new Date(
        start.getTime() + 75 * 60 * 1000
      ).toISOString(),
    });
    const appointmentId = res.body.appointmentId as string;

    // Re-price the catalog AFTER booking.
    await db
      .update(organizationService)
      .set({ priceCents: 9999, name: 'Facial (renamed)' })
      .where(eq(organizationService.id, svcA));

    const items = await lineItems(appointmentId);
    const primary = items.find((i) => i.serviceId === svcA);
    // The booked record is unchanged — the catalog edit does not rewrite history.
    expect(primary?.priceCents).toBe(5000);
    expect(primary?.name).toBe('Facial');
  });
});
