/**
 * Staff-side seeding for the CONSENT-FORM portal specs (ENG-806).
 *
 * The portal specs could not reach consent forms before this file existed:
 * `PortalSeed` knew how to make a lead and a portal session, and
 * `booking-seed.fixture.ts` knew how to make a bookable service, but nothing
 * knew how to make the clinic REQUIRE a form or to put an appointment on the
 * books outside the public booking wizard. So the one surface where a
 * cancelled booking's form is actually seen — the customer's own portal — had
 * no coverage at all.
 *
 * Same shape and same reasoning as `booking-seed.fixture.ts`: thin, asserting
 * wrappers over `PortalSeed.call`, kept in one place so the checks that catch
 * a silently-dropped field live together rather than in each spec.
 *
 * NOTHING HERE FAKES THE CUSTOMER SIDE. Every call is the real staff endpoint
 * a clinic uses; the browser still signs in anonymously and earns its session.
 */
import { expect } from '@playwright/test';
import type { PortalSeed } from './portal-seed.fixture.js';

export interface SeededConsentTemplate {
  id: string;
  title: string;
  requiresSignature: boolean;
}

/**
 * A consent-form template the clinic can attach to a service.
 *
 * `requiresSignature` defaults to FALSE here, unlike the API's own default.
 * A drawn signature means driving a canvas with pointer events and posting a
 * ~100KB data URL through the portal — worth its own spec, and pure noise in
 * one about whether a cancelled booking's form is still shown.
 */
export async function createConsentTemplate(
  seed: PortalSeed,
  data: { title: string; body: string; requiresSignature?: boolean }
): Promise<SeededConsentTemplate> {
  const created = await seed.call<SeededConsentTemplate>(
    'POST',
    '/consent-form-templates',
    { requiresSignature: false, fields: [], ...data }
  );

  expect(
    created.id,
    `createConsentTemplate did not return a row: ${JSON.stringify(created)}`
  ).toBeTruthy();
  expect(created.title).toBe(data.title);
  return created;
}

/**
 * Make a service REQUIRE the given templates — this is what causes a booking
 * for it to issue submissions.
 *
 * The endpoint reconciles the join table to the exact set sent, so this is
 * "set", not "add"; passing `[]` clears the requirement.
 */
export async function requireConsentForService(
  seed: PortalSeed,
  serviceId: string,
  templateIds: string[]
): Promise<void> {
  await seed.call(
    'PUT',
    `/consent-form-templates/organization-services-form-requirements/${serviceId}`,
    { templateIds }
  );

  // Read it back. A requirement that did not stick produces an appointment
  // with no forms, and the spec would then fail several steps later on a
  // missing nudge — reading like a bug in the portal rather than in the seed.
  const requirements = await seed.call<{ items?: Array<{ id: string }> }>(
    'GET',
    `/consent-form-templates/organization-services-form-requirements/${serviceId}`
  );
  const items = requirements?.items ?? [];
  expect(
    items.length,
    `setServiceFormRequirements(${serviceId}) persisted nothing: ${JSON.stringify(requirements)}`
  ).toBe(templateIds.length);
}

export interface SeededAppointment {
  id: string;
  status: string;
}

/**
 * Put an appointment on the books the way STAFF do — the desk/phone booking
 * path, not the public wizard.
 *
 * No `practitionerId` on purpose: `createAppointment` only runs the
 * availability check when one is given, so omitting it keeps the spec off
 * shift patterns and opening hours entirely. The consent forms are issued from
 * `serviceId`, which is what this is really here to exercise.
 */
export async function createStaffAppointment(
  seed: PortalSeed,
  data: {
    title: string;
    leadId: string;
    serviceId: string;
    startDate?: Date;
    durationMinutes?: number;
  }
): Promise<SeededAppointment> {
  const start = data.startDate ?? new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const end = new Date(
    start.getTime() + (data.durationMinutes ?? 30) * 60 * 1000
  );

  const created = await seed.call<SeededAppointment & { serviceId?: string }>(
    'POST',
    '/appointments',
    {
      title: data.title,
      leadId: data.leadId,
      serviceId: data.serviceId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }
  );

  expect(
    created.id,
    `createStaffAppointment did not return a row: ${JSON.stringify(created)}`
  ).toBeTruthy();
  // Without this the appointment issues NO consent forms, and the spec fails
  // far from the cause.
  expect(
    created.serviceId,
    'serviceId was not persisted on the appointment — no consent forms will be issued'
  ).toBe(data.serviceId);
  return created;
}

/** Staff changing a booking's state — cancel, and un-cancel. */
export async function setAppointmentStatus(
  seed: PortalSeed,
  appointmentId: string,
  status: 'booked' | 'confirmed' | 'cancelled' | 'no_show' | 'completed'
): Promise<void> {
  const updated = await seed.call<{ status?: string }>(
    'PUT',
    `/appointments/${appointmentId}`,
    { status }
  );
  expect(
    updated?.status,
    `PUT /appointments/${appointmentId} did not apply status=${status}: ${JSON.stringify(updated)}`
  ).toBe(status);
}

export interface StaffConsentSubmission {
  id: string;
  status: string;
  appointmentId: string;
}

/**
 * Wait for the submissions an appointment's service required.
 *
 * `createAppointment` issues them FIRE-AND-FORGET — the booking is already
 * committed and a consent-form failure must not fail it — so the POST can
 * return before the rows exist. Polling the staff read is the honest way to
 * wait; a fixed sleep would either flake or waste the time it did not need.
 *
 * Throws (never returns empty) if they never appear: a spec that continued
 * with no forms would assert its way through a portal that correctly shows
 * nothing, and pass.
 */
export async function waitForConsentSubmissions(
  seed: PortalSeed,
  appointmentId: string,
  expectedCount = 1,
  timeoutMs = 30_000
): Promise<StaffConsentSubmission[]> {
  const deadline = Date.now() + timeoutMs;
  let last: StaffConsentSubmission[] = [];

  while (Date.now() < deadline) {
    const result = await seed.call<{ items?: StaffConsentSubmission[] }>(
      'GET',
      `/consent-form-templates/submissions?appointmentId=${encodeURIComponent(appointmentId)}`
    );
    last = result?.items ?? [];
    if (last.length >= expectedCount) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `[ConsentSeed] appointment ${appointmentId} still has ${last.length}/${expectedCount} consent submissions after ${timeoutMs}ms. createAppointment issues them fire-and-forget, so either the service requirement did not stick or the issue path failed.`
  );
}
