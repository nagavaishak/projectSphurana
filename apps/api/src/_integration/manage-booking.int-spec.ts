import {
  appointment,
  appointmentManageToken,
  db,
  organization,
} from '@borradh-workspace/database';
import { issueManageToken } from '@borradh-workspace/features/appointments';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — patient self-serve manage-booking (asserted over HTTP against
 * a real DB).
 *
 * This is the PUBLIC, UNAUTHENTICATED surface: the bearer token in the URL is
 * the entire credential. So unlike the other fresha specs, the interesting
 * assertions are not about roles — there is no session — they are about what an
 * anonymous stranger holding a string can and cannot do:
 *
 *   a. HAPPY ROUND-TRIP — a valid link reads the booking, cancels it, and the
 *      cancellation is READ BACK FROM SQL (not inferred from the 200).
 *   b. THE SLOT REOPENS — cancelling flips the status out of
 *      `activeAppointmentStatuses`, which is what every availability and overlap
 *      check filters on. That is the whole "cancelled slot reopens immediately"
 *      requirement, so we assert the status, not a toast.
 *   c. CROSS-ORG — a token minted for org A, replayed against org B's slug, is
 *      invisible. This is the one that matters: it is the difference between a
 *      booking link and a tenant-wide hole.
 *   d. DEAD LINKS — unknown, expired, and wrong-org all 404 with the SAME body,
 *      so an attacker gets no oracle telling them which guess was closer.
 *   e. TERMINAL GUARD — cancelling twice is a 409, not a silent second success.
 *
 * The reschedule happy path needs seeded shifts to have any slots to offer, so
 * it lives in the E2E suite. What IS pinned here is the gate that does not need
 * them: a time the booking page is NOT offering must be refused (409), because
 * that gate is the only thing standing between a bearer token and an
 * appointment at 3am.
 */
import { PublicBookingController } from '../booking-forms/public-booking.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedOrgWithMember,
  seedPractitioner,
  seedService,
} from './harness.js';

const OK = 200;
const CREATED = 201;
const NOT_FOUND = 404;
const CONFLICT = 409;

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

/** Seed an org + a bookable appointment, and mint a real manage link for it. */
async function seedManageableBooking(options?: { startsInHours?: number }) {
  const owner = await seedOrgWithMember('owner');
  const organizationId = owner.organizationId;

  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));

  const serviceId = await seedService({ organizationId, name: 'Lip Filler' });
  const practitionerId = await seedPractitioner({
    organizationId,
    name: 'Dr Ana',
  });

  const startDate = hoursFromNow(options?.startsInHours ?? 48);
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

  const appointmentId = await seedAppointment({
    organizationId,
    assignedToId: owner.userId,
    practitionerId,
    title: 'Lip Filler',
    startDate,
    endDate,
  });

  // seedAppointment does not take a serviceId; the reschedule gate needs one.
  await db
    .update(appointment)
    .set({ serviceId })
    .where(eq(appointment.id, appointmentId));

  const issued = await issueManageToken(db, {
    organizationId,
    appointmentId,
    appointmentEnd: endDate,
  });

  if (!issued.success) throw new Error('failed to seed manage token');

  return {
    organizationId,
    appointmentId,
    serviceId,
    slug: org.slug,
    token: issued.data.token,
    ownerUserId: owner.userId,
  };
}

const statusOf = async (appointmentId: string) => {
  const [row] = await db
    .select({ status: appointment.status })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return row?.status;
};

describe('Fresha domain — manage booking (public, HTTP)', () => {
  let h: IntegrationApp | undefined;

  const buildApp = async () =>
    // PublicBookingController carries no AuthGuard; the identity is irrelevant
    // and never consulted. We pass one only because the harness requires it.
    buildControllerApp(PublicBookingController, {
      userId: 'anonymous',
      organizationId: 'none',
      role: 'owner',
    });

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  describe('happy round-trip', () => {
    it('reads the booking, cancels it, and the cancellation is in the DB', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      const read = await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/${seeded.token}`)
        .expect(OK);

      expect(read.body.appointmentId).toBe(seeded.appointmentId);
      expect(read.body.serviceName).toBe('Lip Filler');
      expect(read.body.practitionerName).toBe('Dr Ana');
      expect(read.body.isActionable).toBe(true);
      // 48h out, default notice is 24h → free.
      expect(read.body.policy.isWithinFreeWindow).toBe(true);

      await request(h.app.getHttpServer())
        .post(`/public/booking/${seeded.slug}/manage/${seeded.token}/cancel`)
        .send({ reason: 'Feeling unwell' })
        .expect(CREATED);

      // The 201 means "accepted". THIS is what means "landed".
      expect(await statusOf(seeded.appointmentId)).toBe('cancelled');
    });

    it('reopens the slot — the row leaves the active statuses that block booking', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      expect(await statusOf(seeded.appointmentId)).toBe('booked');

      await request(h.app.getHttpServer())
        .post(`/public/booking/${seeded.slug}/manage/${seeded.token}/cancel`)
        .send({})
        .expect(CREATED);

      const status = await statusOf(seeded.appointmentId);

      // `activeAppointmentStatuses` = booked | confirmed | arrived | started.
      // Availability and the overlap constraint both filter on it, so leaving
      // that set IS the reopen — there is nothing else to notify.
      expect(['booked', 'confirmed', 'arrived', 'started']).not.toContain(
        status
      );
      expect(status).toBe('cancelled');
    });

    it('surfaces the late-cancellation fee for an imminent booking', async () => {
      const seeded = await seedManageableBooking({ startsInHours: 2 });
      await db
        .update(organization)
        .set({ noShowOrLateCancelFeeCents: 2500 })
        .where(eq(organization.id, seeded.organizationId));

      h = await buildApp();

      const read = await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/${seeded.token}`)
        .expect(OK);

      expect(read.body.policy.isWithinFreeWindow).toBe(false);
      expect(read.body.policy.lateFeeCents).toBe(2500);
    });
  });

  describe('cross-org', () => {
    it("a token minted for org A is invisible under org B's slug", async () => {
      const orgA = await seedManageableBooking();
      const orgB = await seedManageableBooking();
      h = await buildApp();

      // Replay A's token against B's slug. The token lookup runs INSIDE B's org
      // scope, so org_isolation makes A's row simply not exist.
      await request(h.app.getHttpServer())
        .get(`/public/booking/${orgB.slug}/manage/${orgA.token}`)
        .expect(NOT_FOUND);

      // And it must not have cancelled anything, either.
      await request(h.app.getHttpServer())
        .post(`/public/booking/${orgB.slug}/manage/${orgA.token}/cancel`)
        .send({})
        .expect(NOT_FOUND);

      expect(await statusOf(orgA.appointmentId)).toBe('booked');
      expect(await statusOf(orgB.appointmentId)).toBe('booked');
    });
  });

  describe('dead links', () => {
    it('404s an unknown token', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/not-a-real-token`)
        .expect(NOT_FOUND);
    });

    it('404s an EXPIRED token', async () => {
      const seeded = await seedManageableBooking();

      await db
        .update(appointmentManageToken)
        .set({ expiresAt: hoursFromNow(-1) })
        .where(eq(appointmentManageToken.appointmentId, seeded.appointmentId));

      h = await buildApp();

      await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/${seeded.token}`)
        .expect(NOT_FOUND);
    });

    it('404s an unknown org slug', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .get(`/public/booking/no-such-clinic/manage/${seeded.token}`)
        .expect(NOT_FOUND);
    });

    it('gives the same body for unknown, expired, and wrong-org — no oracle', async () => {
      const seeded = await seedManageableBooking();
      const other = await seedManageableBooking();
      h = await buildApp();

      const unknown = await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/bogus-token`)
        .expect(NOT_FOUND);

      const wrongOrg = await request(h.app.getHttpServer())
        .get(`/public/booking/${other.slug}/manage/${seeded.token}`)
        .expect(NOT_FOUND);

      await db
        .update(appointmentManageToken)
        .set({ expiresAt: hoursFromNow(-1) })
        .where(eq(appointmentManageToken.appointmentId, seeded.appointmentId));

      const expired = await request(h.app.getHttpServer())
        .get(`/public/booking/${seeded.slug}/manage/${seeded.token}`)
        .expect(NOT_FOUND);

      // Distinguishing these would tell an attacker which guess was closer.
      expect(unknown.body.message).toBe(wrongOrg.body.message);
      expect(wrongOrg.body.message).toBe(expired.body.message);
    });
  });

  describe('terminal guard', () => {
    it('cancelling twice is a 409, not a silent second success', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .post(`/public/booking/${seeded.slug}/manage/${seeded.token}/cancel`)
        .send({})
        .expect(CREATED);

      await request(h.app.getHttpServer())
        .post(`/public/booking/${seeded.slug}/manage/${seeded.token}/cancel`)
        .send({})
        .expect(CONFLICT);

      expect(await statusOf(seeded.appointmentId)).toBe('cancelled');
    });

    it('a cancelled booking cannot be rescheduled', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .post(`/public/booking/${seeded.slug}/manage/${seeded.token}/cancel`)
        .send({})
        .expect(CREATED);

      await request(h.app.getHttpServer())
        .post(
          `/public/booking/${seeded.slug}/manage/${seeded.token}/reschedule`
        )
        .send({ startDate: hoursFromNow(72).toISOString() })
        .expect(CONFLICT);
    });
  });

  describe('reschedule gate', () => {
    it('REFUSES a time the booking page is not offering', async () => {
      // The org has no shifts seeded, so the booking page offers nothing at all.
      // A bearer token must not be able to conjure a slot out of that — which is
      // exactly what would happen if we trusted the client's timestamp and let
      // the DB constraint be the only check (an empty calendar has no overlaps).
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .post(
          `/public/booking/${seeded.slug}/manage/${seeded.token}/reschedule`
        )
        .send({ startDate: hoursFromNow(72).toISOString() })
        .expect(CONFLICT);

      // Unmoved.
      const [row] = await db
        .select({ startDate: appointment.startDate })
        .from(appointment)
        .where(eq(appointment.id, seeded.appointmentId));

      expect(row.startDate.getTime()).toBeLessThan(hoursFromNow(50).getTime());
    });

    it('rejects a start time in the past', async () => {
      const seeded = await seedManageableBooking();
      h = await buildApp();

      await request(h.app.getHttpServer())
        .post(
          `/public/booking/${seeded.slug}/manage/${seeded.token}/reschedule`
        )
        .send({ startDate: hoursFromNow(-2).toISOString() })
        .expect(400);
    });
  });
});
