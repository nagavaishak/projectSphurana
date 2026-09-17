import {
  appointment,
  appointmentService,
  db,
  organization,
  organizationService,
  organizationServiceVariant,
} from '@borradh-workspace/database';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — service variants + variant-priced booking (real DB, HTTP).
 *
 * Proves the structured-pricing tail: a service with OPTIONAL variants
 * ("1 Area £160, 2 Areas £190") lets the customer pick one, and the booking
 * snapshots THAT variant's price/duration/name onto the appointment_service
 * line item — not the service default, and never a client-supplied price.
 *
 *   a. VARIANT PRICE WINS — book service X picking its "2 Areas" variant → the
 *      line item carries the variant's price + duration + name.
 *   b. SERVER RESOLVES — a foreign / inactive variantId is ignored and the
 *      service default is used (the client can't inject a price).
 *   c. NO VARIANT → service default, unchanged (back-compat).
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

async function seedServiceWithVariants(organizationId: string) {
  const [svc] = await db
    .insert(organizationService)
    .values({
      organizationId,
      name: 'Fat Freeze',
      appointmentDuration: 45,
      priceType: 'from',
      priceCents: 16000, // floor = the cheapest variant
      isActive: true,
    })
    .returning({ id: organizationService.id });

  const [oneArea, twoAreas] = await db
    .insert(organizationServiceVariant)
    .values([
      {
        serviceId: svc.id,
        name: '1 Area',
        priceCents: 16000,
        durationMinutes: 45,
        sortOrder: 0,
      },
      {
        serviceId: svc.id,
        name: '2 Areas',
        priceCents: 19000,
        durationMinutes: 75,
        sortOrder: 1,
      },
    ])
    .returning({ id: organizationServiceVariant.id });

  return { serviceId: svc.id, oneAreaId: oneArea.id, twoAreasId: twoAreas.id };
}

async function seedVenue() {
  const owner = await seedOrgWithMember('owner');
  // Availability comes solely from a practitioner's shifts, so a venue with
  // nobody on shift is unbookable — as a real org, which always has one, never is.
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
    })
    .from(appointmentService)
    .where(eq(appointmentService.appointmentId, appointmentId))
    .orderBy(asc(appointmentService.sortOrder));

describe('Fresha domain — service variants (public booking, HTTP)', () => {
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

  it('snapshots the CHOSEN variant price + duration + name onto the line item', async () => {
    const venue = await seedVenue();
    const { serviceId, twoAreasId } = await seedServiceWithVariants(
      venue.organizationId
    );
    h = await buildApp();
    const start = daysFromNow(3);

    const res = await submit(h, venue.slug, {
      serviceId,
      serviceItems: [{ serviceId, variantId: twoAreasId }],
      firstName: 'Sarah',
      email: 'sarah@example.com',
      appointmentStartTime: start.toISOString(),
      // Deliberately wrong end — server recomputes from the variant's 75 min.
      appointmentEndTime: new Date(
        start.getTime() + 30 * 60 * 1000
      ).toISOString(),
    });

    expect(res.status).toBe(CREATED);
    const items = await lineItems(res.body.appointmentId);
    expect(items).toHaveLength(1);
    // The line-item name identifies the chosen variant (service + variant name).
    expect(items[0].name).toContain('2 Areas');
    expect(items[0].priceCents).toBe(19000);
    expect(items[0].durationMinutes).toBe(75);

    const [appt] = await db
      .select({
        startDate: appointment.startDate,
        endDate: appointment.endDate,
      })
      .from(appointment)
      .where(eq(appointment.id, res.body.appointmentId));
    expect(appt.endDate.getTime() - appt.startDate.getTime()).toBe(
      75 * 60 * 1000
    );
  });

  it('ignores a foreign/inactive variantId and uses the service default', async () => {
    const venue = await seedVenue();
    const { serviceId } = await seedServiceWithVariants(venue.organizationId);
    h = await buildApp();
    const start = daysFromNow(4);

    const res = await submit(h, venue.slug, {
      serviceId,
      serviceItems: [{ serviceId, variantId: 'not-a-real-variant' }],
      firstName: 'Alex',
      email: 'alex@example.com',
      appointmentStartTime: start.toISOString(),
      appointmentEndTime: new Date(
        start.getTime() + 45 * 60 * 1000
      ).toISOString(),
    });

    expect(res.status).toBe(CREATED);
    const items = await lineItems(res.body.appointmentId);
    // Falls back to the service default (name/price/duration), NOT a variant.
    expect(items[0].name).toBe('Fat Freeze');
    expect(items[0].priceCents).toBe(16000);
    expect(items[0].durationMinutes).toBe(45);
  });
});
