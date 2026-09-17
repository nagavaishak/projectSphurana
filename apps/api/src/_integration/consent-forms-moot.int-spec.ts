import {
  type ConsentFormSubmissionStatus,
  type NewConsentFormSubmission,
  appointment as appointmentTable,
  consentFormSubmission,
  consentFormTemplate,
  db,
} from '@borradh-workspace/database';
import type { AppointmentStatus } from '@borradh-workspace/labels';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * ENG-806 — a cancelled appointment's PENDING consent forms must leave the
 * patient portal, asserted over HTTP against a real database.
 *
 * WHAT THE UNIT LAYER ALREADY PROVES, AND WHY THAT IS NOT ENOUGH.
 * `moot-consent.test.ts` pins the RULE (`isPendingFormMoot`) and the three
 * services' tests pin their use of it against a mocked db. Neither runs a line
 * of SQL. So three things stayed unproven, and each is a way the fix could
 * ship broken with a green suite:
 *
 *   a. THE LOADERS. `loadConsentAppointmentState(s)` are the only new SQL —
 *      an `inArray` batch keyed by appointment id, and both are org-filtered.
 *      A wrong column, a `Map` keyed by the wrong field, or an org filter that
 *      never matches all fail SILENTLY as "appointment not found", which the
 *      rule deliberately treats as LIVE. The bug would present as "the fix
 *      does nothing" — exactly what a mocked test cannot see.
 *
 *   b. THE STATUS CODE. `get` returns NOT_FOUND; the portal only renders
 *      "this form may have been removed" if that reaches the browser as a
 *      404. The mapping lives in the controller, not the service.
 *
 *   c. THE WRITE-SIDE REFUSAL. `sign` must not merely answer with an error —
 *      the row must still be `pending` afterwards. A service that returned the
 *      error AFTER updating would pass its unit test and still archive consent
 *      for a visit that never happened.
 *
 * AND ONE CLAIM ONLY A REAL DB CAN SETTLE: un-cancel. The whole reason this is
 * DERIVED at read time rather than stamped as a stored `voided` status is that
 * `PUT /appointments/:id` accepts any status, so staff can put a cancelled
 * booking back. A stored flag would stay set. Here the appointment row is
 * really mutated back and the same submission is asked for again.
 */
import { PatientConsentFormsController } from '../consent-forms/patient-consent-forms.controller.js';
import {
  type PatientIntegrationApp,
  buildPatientControllerApp,
  seedAppointment,
  seedLead,
  seedOrgWithMember,
} from './harness.js';

const OK = 200;
const NOT_FOUND = 404;

interface Fixture {
  submissionId: string;
  appointmentId: string;
  leadId: string;
}

describe('ENG-806 — cancelled appointments hide their pending consent forms', () => {
  let portal: PatientIntegrationApp;

  let organizationId: string;
  let ownerUserId: string;
  let templateId: string;
  /** The patient the portal is signed in as for most of these. */
  let leadId: string;

  /**
   * One appointment + one consent form for it, in whatever state the caller
   * names. Seeded directly rather than driven through
   * `createSubmissionsForAppointment` on purpose: that path is fire-and-forget
   * from `createAppointment`, so racing it would make these tests flaky about
   * something they are not asserting.
   */
  async function seedFormForAppointment(input: {
    appointmentStatus?: AppointmentStatus;
    appointmentDeletedAt?: Date | null;
    submissionStatus?: ConsentFormSubmissionStatus;
    leadId?: string;
    title?: string;
  }): Promise<Fixture> {
    const forLead = input.leadId ?? leadId;
    const appointmentId = await seedAppointment({
      organizationId,
      assignedToId: ownerUserId,
      leadId: forLead,
      status: input.appointmentStatus,
      deletedAt: input.appointmentDeletedAt ?? null,
    });

    const submissionStatus = input.submissionStatus ?? 'pending';
    const values: NewConsentFormSubmission = {
      organizationId,
      appointmentId,
      leadId: forLead,
      templateId,
      templateSnapshot: {
        title: input.title ?? 'Treatment consent',
        body: 'I consent to the treatment described.',
        fields: [],
        // No drawn signature: the sign happy-path below would otherwise need
        // an S3 upload, which this harness has no business performing.
        requiresSignature: false,
      },
      status: submissionStatus,
      sentAt: new Date(),
      ...(submissionStatus === 'completed'
        ? { signedAt: new Date(), signedByName: 'A Patient' }
        : {}),
    };
    const [row] = await db
      .insert(consentFormSubmission)
      .values(values)
      .returning({ id: consentFormSubmission.id });

    return { submissionId: row.id, appointmentId, leadId: forLead };
  }

  /** The list the portal actually renders, as ids. */
  async function listedIds(): Promise<string[]> {
    const res = await request(portal.app.getHttpServer()).get(
      '/patient/consent-forms'
    );
    expect(res.status).toBe(OK);
    return (res.body.items as Array<{ id: string }>).map((item) => item.id);
  }

  async function statusOf(submissionId: string): Promise<string> {
    const [row] = await db
      .select({ status: consentFormSubmission.status })
      .from(consentFormSubmission)
      .where(eq(consentFormSubmission.id, submissionId));
    return row.status;
  }

  beforeAll(async () => {
    const owner = await seedOrgWithMember('owner');
    organizationId = owner.organizationId;
    ownerUserId = owner.userId;

    const [template] = await db
      .insert(consentFormTemplate)
      .values({
        organizationId,
        title: 'Treatment consent',
        body: 'I consent to the treatment described.',
        requiresSignature: false,
      })
      .returning({ id: consentFormTemplate.id });
    templateId = template.id;

    leadId = await seedLead({ organizationId, firstName: 'Portal Patient' });

    portal = await buildPatientControllerApp(PatientConsentFormsController, {
      leadId,
      organizationId,
    });
  });

  afterAll(async () => {
    await portal?.close();
  });

  /* ---------------------------------------------------------------- */
  /* GET /patient/consent-forms — the "forms to complete" list.        */
  /* ---------------------------------------------------------------- */

  describe('the list', () => {
    it('drops a pending form whose appointment was cancelled, and keeps a live one', async () => {
      // Both in ONE assertion pass: a filter that dropped everything would
      // satisfy "the cancelled one is gone" on its own.
      const cancelled = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
      });
      const live = await seedFormForAppointment({
        appointmentStatus: 'booked',
      });

      const ids = await listedIds();

      expect(ids).not.toContain(cancelled.submissionId);
      expect(ids).toContain(live.submissionId);
    });

    it('drops a pending form whose appointment was soft-deleted', async () => {
      const softDeleted = await seedFormForAppointment({
        appointmentDeletedAt: new Date(),
      });

      expect(await listedIds()).not.toContain(softDeleted.submissionId);
    });

    it('KEEPS a form the patient already signed, even on a cancelled appointment', async () => {
      // An executed consent is a legal instrument. Cancelling the booking
      // afterwards must not take it away from the person who signed it.
      const signed = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
        submissionStatus: 'completed',
      });

      expect(await listedIds()).toContain(signed.submissionId);
    });

    it.each(['no_show', 'completed'] as const)(
      'keeps a pending form on a %s appointment',
      async (appointmentStatus) => {
        // These describe a visit that DID reach its slot. An unsigned form is
        // a real compliance gap the clinic still wants chased — hiding it
        // would quietly shrink their own to-do list.
        const reached = await seedFormForAppointment({ appointmentStatus });

        expect(await listedIds()).toContain(reached.submissionId);
      }
    );

    it('scopes the appointment lookup to the caller, not just to the id', async () => {
      // The loaders filter on organizationId as well as the id. If that filter
      // were wrong the row would come back UNREADABLE, the rule would fail
      // open, and the cancelled form would reappear — a silent regression that
      // looks exactly like the original bug.
      const otherOrg = await seedOrgWithMember('owner');
      const otherLead = await seedLead({
        organizationId: otherOrg.organizationId,
      });
      await seedAppointment({
        organizationId: otherOrg.organizationId,
        assignedToId: otherOrg.userId,
        leadId: otherLead,
        status: 'cancelled',
      });

      const mine = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
      });

      expect(await listedIds()).not.toContain(mine.submissionId);
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /patient/consent-forms/:id — the sign screen.                 */
  /* ---------------------------------------------------------------- */

  describe('opening one form', () => {
    it('404s a pending form on a cancelled appointment', async () => {
      // An emailed link or a tab left open overnight must not still reach the
      // sign screen. 404 specifically: that is what the portal renders as
      // "this form may have been removed".
      const cancelled = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
      });

      const res = await request(portal.app.getHttpServer()).get(
        `/patient/consent-forms/${cancelled.submissionId}`
      );

      expect(res.status).toBe(NOT_FOUND);
    });

    it('still returns a SIGNED form on a cancelled appointment', async () => {
      const signed = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
        submissionStatus: 'completed',
      });

      const res = await request(portal.app.getHttpServer()).get(
        `/patient/consent-forms/${signed.submissionId}`
      );

      expect(res.status).toBe(OK);
      expect(res.body.id).toBe(signed.submissionId);
    });

    it('returns a pending form on a live appointment', async () => {
      const live = await seedFormForAppointment({
        appointmentStatus: 'booked',
      });

      const res = await request(portal.app.getHttpServer()).get(
        `/patient/consent-forms/${live.submissionId}`
      );

      expect(res.status).toBe(OK);
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /patient/consent-forms/:id/sign — the write-side guard.      */
  /* ---------------------------------------------------------------- */

  describe('signing', () => {
    it('refuses to sign a form whose appointment was cancelled, and writes nothing', async () => {
      const cancelled = await seedFormForAppointment({
        appointmentStatus: 'cancelled',
      });

      const res = await request(portal.app.getHttpServer())
        .post(`/patient/consent-forms/${cancelled.submissionId}/sign`)
        .send({ attested: true, fieldData: {}, signedByName: 'A Patient' });

      expect(res.status).toBe(NOT_FOUND);
      // The refusal is worth nothing if the row moved anyway: a completed
      // submission also BLOCKS the clinic's hard-delete of the slot.
      expect(await statusOf(cancelled.submissionId)).toBe('pending');
    });

    it('refuses to sign a form whose appointment was soft-deleted', async () => {
      const softDeleted = await seedFormForAppointment({
        appointmentDeletedAt: new Date(),
      });

      const res = await request(portal.app.getHttpServer())
        .post(`/patient/consent-forms/${softDeleted.submissionId}/sign`)
        .send({ attested: true, fieldData: {} });

      expect(res.status).toBe(NOT_FOUND);
      expect(await statusOf(softDeleted.submissionId)).toBe('pending');
    });

    it('signs a form on a live appointment', async () => {
      // The control. Without it every assertion above is satisfied by a guard
      // that refuses everything.
      const live = await seedFormForAppointment({
        appointmentStatus: 'booked',
      });

      const res = await request(portal.app.getHttpServer())
        .post(`/patient/consent-forms/${live.submissionId}/sign`)
        .send({ attested: true, fieldData: {}, signedByName: 'A Patient' });

      expect(res.status).toBe(201);
      expect(await statusOf(live.submissionId)).toBe('completed');
    });
  });

  /* ---------------------------------------------------------------- */
  /* The reason this is derived and not stored.                        */
  /* ---------------------------------------------------------------- */

  it('brings the form BACK when staff un-cancel the appointment', async () => {
    // This is the whole argument for deriving the answer at read time.
    // `PUT /appointments/:id` accepts any status, so an un-cancel is a
    // supported staff action — and a `voided` column stamped at cancel time
    // would stay stamped, leaving the patient permanently unable to sign a
    // form for a booking that is back on.
    const form = await seedFormForAppointment({
      appointmentStatus: 'cancelled',
    });

    expect(await listedIds()).not.toContain(form.submissionId);

    await db
      .update(appointmentTable)
      .set({ status: 'booked' })
      .where(eq(appointmentTable.id, form.appointmentId));

    expect(await listedIds()).toContain(form.submissionId);

    // And it is signable again — not merely visible.
    const res = await request(portal.app.getHttpServer())
      .post(`/patient/consent-forms/${form.submissionId}/sign`)
      .send({ attested: true, fieldData: {}, signedByName: 'A Patient' });
    expect(res.status).toBe(201);
  });

  it('does not leak another patient’s forms through the same routes', async () => {
    // The moot filter narrows what a patient sees; it must not be the only
    // thing standing between two patients. Pinned here because these tests
    // are the ones that would notice a filter rewrite going too wide.
    const otherLead = await seedLead({ organizationId, firstName: 'Someone' });
    const theirs = await seedFormForAppointment({
      appointmentStatus: 'booked',
      leadId: otherLead,
    });

    expect(await listedIds()).not.toContain(theirs.submissionId);

    const res = await request(portal.app.getHttpServer()).get(
      `/patient/consent-forms/${theirs.submissionId}`
    );
    expect(res.status).toBe(NOT_FOUND);
  });
});
