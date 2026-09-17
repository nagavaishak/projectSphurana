/**
 * Batch E (part 2) — appointment double-booking / slot state machine.
 *
 * Drives the appointments feature services directly against the real test DB.
 *
 * Behaviour locked here:
 *  - Conflict detection EXISTS. `hasOverlappingAppointment` keys on
 *    (assignedToId, organizationId, status in the active set (booked/confirmed/arrived/started)) with the standard
 *    half-open interval overlap test (existing.start < new.end AND
 *    existing.end > new.start). Both create and update enforce it.
 *  - Conflicts also clash on the SAME `practitionerId` regardless of assignee:
 *    a practitioner cannot be double-booked (fixed — previously assignee-only).
 *    When no practitioner is set, only the assignee is considered.
 *  - The check applies to EVERY source, including staff-side (`manual`)
 *    bookings, which used to skip it entirely (ENG-792). Deliberate
 *    double-booking is still possible, but only via an explicit
 *    `allowDoubleBooking: true` — which is also what the row records, so a
 *    confirmed overlap stays out of the `appointment_no_overlap` constraint
 *    while an ordinary staff booking is protected by it.
 *  - Reschedule (update of start/end) re-checks overlap but EXCLUDES the row
 *    being updated, so moving an appointment frees its old slot.
 *  - Cancelling (status not active (e.g. cancelled)) removes the row from conflict
 *    consideration, freeing the slot for a new booking.
 */
import { randomUUID } from 'node:crypto';
import { db, practitioner } from '@borradh-workspace/database';
import {
  createAppointment,
  updateAppointment,
} from '@borradh-workspace/features/appointments';
import { seedLead, seedOrganization, seedUser } from './harness.js';

/** Seed a practitioner row and return its id. */
async function seedPractitioner(organizationId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(practitioner).values({
    id,
    organizationId,
    name: `Practitioner ${id.slice(0, 8)}`,
    email: `prac-${id.slice(0, 8)}@example.com`,
  });
  return id;
}

/** Seed an org + assignee user + lead, returning the ids a booking needs. */
async function seedBookingContext() {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  return { organizationId, assignedToId: assignee.id, leadId };
}

/**
 * The fixture literals below (2026-03-01 … 2026-03-07) encode only the RELATIVE
 * day/time structure the double-booking assertions depend on (same-slot
 * collisions, adjacent half-open intervals, distinct days). The create-side
 * Phase 3 backstop rejects a `startDate` more than 24h in the past, so those
 * absolute literals would time-bomb the moment the real clock passes them.
 *
 * `at()` rebases the whole fixture week onto a fixed near-future anchor
 * (computed once from the real clock), shifting every literal by the same
 * delta — intervals and day gaps are preserved exactly, and no booking is ever
 * in the past. Deterministic within a run (single `FUTURE_ANCHOR_MS`).
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 2, 1); // earliest literal: 2026-03-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14); // comfortably future, past the grace
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

describe('Batch E — appointment double-booking', () => {
  it('rejects a conflicting slot for the same assignee (CONFLICT, not double-booked)', async () => {
    const ctx = await seedBookingContext();

    const first = await createAppointment(db, {
      title: 'First booking',
      startDate: at('2026-03-01T10:00:00.000Z'),
      endDate: at('2026-03-01T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(first.success).toBe(true);

    // Overlapping window (10:30–11:30) for the SAME assignee → conflict.
    // Overlap enforcement is online-only (source !== 'manual'); manual/console
    // bookings deliberately double-book, so this must come in as a customer
    // booking to be rejected.
    const second = await createAppointment(db, {
      title: 'Overlapping booking',
      startDate: at('2026-03-01T10:30:00.000Z'),
      endDate: at('2026-03-01T11:30:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
      source: 'booking_form',
    });
    expect(second.success).toBe(false);
    if (second.success)
      throw new Error('expected double-booking to be rejected');
    expect(second.error.code).toBe('CONFLICT');
  });

  it('allows the same time slot for a DIFFERENT assignee', async () => {
    const organizationId = await seedOrganization();
    const a = await seedUser();
    const b = await seedUser();
    const leadId = await seedLead({ organizationId });

    const first = await createAppointment(db, {
      title: 'Assignee A',
      startDate: at('2026-03-02T09:00:00.000Z'),
      endDate: at('2026-03-02T10:00:00.000Z'),
      leadId,
      assignedToId: a.id,
      organizationId,
    });
    expect(first.success).toBe(true);

    const second = await createAppointment(db, {
      title: 'Assignee B same time',
      startDate: at('2026-03-02T09:00:00.000Z'),
      endDate: at('2026-03-02T10:00:00.000Z'),
      leadId,
      assignedToId: b.id,
      organizationId,
    });
    expect(second.success).toBe(true);
  });

  it('rejects an overlapping slot for the SAME practitioner even with a different assignee', async () => {
    const organizationId = await seedOrganization();
    const a = await seedUser();
    const b = await seedUser();
    const leadId = await seedLead({ organizationId });
    const practitionerId = await seedPractitioner(organizationId);

    const first = await createAppointment(db, {
      title: 'Practitioner booked (assignee A)',
      startDate: at('2026-03-06T10:00:00.000Z'),
      endDate: at('2026-03-06T11:00:00.000Z'),
      leadId,
      assignedToId: a.id,
      practitionerId,
      organizationId,
    });
    expect(first.success).toBe(true);

    // Different assignee, SAME practitioner, overlapping window → must conflict.
    // Online-only enforcement: comes in as a customer booking so the
    // per-practitioner overlap check runs (manual bookings bypass it).
    const second = await createAppointment(db, {
      title: 'Same practitioner, assignee B, overlapping',
      startDate: at('2026-03-06T10:30:00.000Z'),
      endDate: at('2026-03-06T11:30:00.000Z'),
      leadId,
      assignedToId: b.id,
      practitionerId,
      organizationId,
      source: 'booking_form',
    });
    expect(second.success).toBe(false);
    if (second.success)
      throw new Error(
        'expected per-practitioner double-booking to be rejected'
      );
    expect(second.error.code).toBe('CONFLICT');
  });

  it('allows a non-overlapping slot for the same practitioner', async () => {
    const organizationId = await seedOrganization();
    const a = await seedUser();
    const leadId = await seedLead({ organizationId });
    const practitionerId = await seedPractitioner(organizationId);

    const first = await createAppointment(db, {
      title: 'Practitioner slot 1',
      startDate: at('2026-03-07T10:00:00.000Z'),
      endDate: at('2026-03-07T11:00:00.000Z'),
      leadId,
      assignedToId: a.id,
      practitionerId,
      organizationId,
    });
    expect(first.success).toBe(true);

    const second = await createAppointment(db, {
      title: 'Practitioner slot 2 (later)',
      startDate: at('2026-03-07T11:00:00.000Z'),
      endDate: at('2026-03-07T12:00:00.000Z'),
      leadId,
      assignedToId: a.id,
      practitionerId,
      organizationId,
    });
    expect(second.success).toBe(true);
  });

  it('allows a back-to-back (non-overlapping, half-open) slot for the same assignee', async () => {
    const ctx = await seedBookingContext();

    const first = await createAppointment(db, {
      title: 'Slot 1',
      startDate: at('2026-03-03T10:00:00.000Z'),
      endDate: at('2026-03-03T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(first.success).toBe(true);

    // Starts exactly when the first ends — half-open intervals do not overlap.
    const second = await createAppointment(db, {
      title: 'Slot 2 (back-to-back)',
      startDate: at('2026-03-03T11:00:00.000Z'),
      endDate: at('2026-03-03T12:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(second.success).toBe(true);
  });

  it('reschedule frees the old slot: a new booking can take it', async () => {
    const ctx = await seedBookingContext();

    const original = await createAppointment(db, {
      title: 'Original',
      startDate: at('2026-03-04T10:00:00.000Z'),
      endDate: at('2026-03-04T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(original.success).toBe(true);
    if (!original.success) throw new Error('setup failed');

    // Move it to a different (non-conflicting) time.
    const moved = await updateAppointment(db, {
      id: original.data.id,
      organizationId: ctx.organizationId,
      startDate: at('2026-03-04T14:00:00.000Z'),
      endDate: at('2026-03-04T15:00:00.000Z'),
    });
    expect(moved.success).toBe(true);

    // The original 10:00–11:00 window is now free — booking it must succeed.
    const newBooking = await createAppointment(db, {
      title: 'Takes the freed slot',
      startDate: at('2026-03-04T10:00:00.000Z'),
      endDate: at('2026-03-04T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(newBooking.success).toBe(true);
  });

  // ── ENG-792 — a staff booking may no longer overlap SILENTLY ──────────────
  //
  // Every case below comes in as a `manual` booking (the wire DEFAULT, and what
  // the staff calendar sends). Before this fix all four were created without a
  // word.
  describe('staff-side (manual) double-booking', () => {
    /** Seed an org + assignee + lead + practitioner and take a 10:00-11:00 slot. */
    async function seedTakenSlot(day: string) {
      const organizationId = await seedOrganization();
      const assignee = await seedUser();
      const leadId = await seedLead({ organizationId });
      const practitionerId = await seedPractitioner(organizationId);

      const first = await createAppointment(db, {
        title: 'Existing manual booking',
        startDate: at(`${day}T10:00:00.000Z`),
        endDate: at(`${day}T11:00:00.000Z`),
        leadId,
        assignedToId: assignee.id,
        practitionerId,
        organizationId,
      });
      expect(first.success).toBe(true);

      return { organizationId, assignee, leadId, practitionerId };
    }

    it.each([
      ['exact start', '10:00', '11:00'],
      ['partial overlap', '10:30', '11:30'],
      ['containment (new inside existing)', '10:15', '10:45'],
      ['containment (new around existing)', '09:30', '11:30'],
    ])(
      'rejects a manual booking that clashes — %s',
      async (_label, start, end) => {
        const ctx = await seedTakenSlot('2026-03-10');

        const second = await createAppointment(db, {
          title: 'Clashing manual booking',
          startDate: at(`2026-03-10T${start}:00.000Z`),
          endDate: at(`2026-03-10T${end}:00.000Z`),
          leadId: ctx.leadId,
          assignedToId: ctx.assignee.id,
          practitionerId: ctx.practitionerId,
          organizationId: ctx.organizationId,
        });

        expect(second.success).toBe(false);
        if (second.success)
          throw new Error('expected the clashing manual booking to be refused');
        expect(second.error.code).toBe('CONFLICT');
        // The refusal identifies WHAT was clashed with — it is the text the
        // calendar shows in its "Book anyway?" confirmation.
        expect(second.error.message).toContain('Existing manual booking');
      }
    );

    it('creates the overlap once the caller confirms it', async () => {
      const ctx = await seedTakenSlot('2026-03-11');

      const confirmed = await createAppointment(db, {
        title: 'Deliberate double-booking',
        startDate: at('2026-03-11T10:30:00.000Z'),
        endDate: at('2026-03-11T11:30:00.000Z'),
        leadId: ctx.leadId,
        assignedToId: ctx.assignee.id,
        practitionerId: ctx.practitionerId,
        organizationId: ctx.organizationId,
        allowDoubleBooking: true,
      });

      // Both the application check AND the DB exclusion constraint have to let
      // this through — the row is written with allow_double_booking = true,
      // which is exactly what removes it from the constraint's partial index.
      expect(confirmed.success).toBe(true);
      if (!confirmed.success) throw new Error(confirmed.error.message);
      expect(confirmed.data.allowDoubleBooking).toBe(true);
    });

    it('leaves an ordinary manual booking protected by the DB constraint', async () => {
      const organizationId = await seedOrganization();
      const assignee = await seedUser();
      const leadId = await seedLead({ organizationId });
      const practitionerId = await seedPractitioner(organizationId);

      const booking = await createAppointment(db, {
        title: 'Ordinary manual booking',
        startDate: at('2026-03-12T10:00:00.000Z'),
        endDate: at('2026-03-12T11:00:00.000Z'),
        leadId,
        assignedToId: assignee.id,
        practitionerId,
        organizationId,
      });

      expect(booking.success).toBe(true);
      if (!booking.success) throw new Error(booking.error.message);
      // Manual bookings used to be written with `true` unconditionally, opting
      // every single one out of the backstop.
      expect(booking.data.allowDoubleBooking).toBe(false);
    });

    it('refuses to reschedule a manual booking ONTO an occupied slot', async () => {
      const ctx = await seedTakenSlot('2026-03-13');

      const mover = await createAppointment(db, {
        title: 'Booking to be dragged',
        startDate: at('2026-03-13T14:00:00.000Z'),
        endDate: at('2026-03-13T15:00:00.000Z'),
        leadId: ctx.leadId,
        assignedToId: ctx.assignee.id,
        practitionerId: ctx.practitionerId,
        organizationId: ctx.organizationId,
      });
      expect(mover.success).toBe(true);
      if (!mover.success) throw new Error(mover.error.message);

      // Dragging it on top of the 10:00-11:00 booking. This is the same
      // bypass the create path had: a drag could land anywhere, silently.
      const dragged = await updateAppointment(db, {
        id: mover.data.id,
        organizationId: ctx.organizationId,
        startDate: at('2026-03-13T10:30:00.000Z'),
        endDate: at('2026-03-13T11:30:00.000Z'),
      });

      expect(dragged.success).toBe(false);
      if (dragged.success)
        throw new Error(
          'expected the drag onto an occupied slot to be refused'
        );
      expect(dragged.error.code).toBe('CONFLICT');
    });
  });

  it('cancel frees the slot: a new booking can take it', async () => {
    const ctx = await seedBookingContext();

    const original = await createAppointment(db, {
      title: 'To be cancelled',
      startDate: at('2026-03-05T10:00:00.000Z'),
      endDate: at('2026-03-05T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(original.success).toBe(true);
    if (!original.success) throw new Error('setup failed');

    const cancelled = await updateAppointment(db, {
      id: original.data.id,
      organizationId: ctx.organizationId,
      status: 'cancelled',
    });
    expect(cancelled.success).toBe(true);

    // Same window again — cancelled appointment must not block it.
    const rebooked = await createAppointment(db, {
      title: 'Rebooked after cancel',
      startDate: at('2026-03-05T10:00:00.000Z'),
      endDate: at('2026-03-05T11:00:00.000Z'),
      leadId: ctx.leadId,
      assignedToId: ctx.assignedToId,
      organizationId: ctx.organizationId,
    });
    expect(rebooked.success).toBe(true);
  });
});
