import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type MockInstance, vi } from 'vitest';
import * as consentFormsModule from '../../../consent-forms/index.js';
import * as resolveAvailabilityModule from '../../../scheduling/services/resolve-availability/resolve-availability.service.js';
import * as resourceGateModule from '../../../scheduling/services/resolve-resource-availability/filter-slots-by-resources.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as appointmentQueueModule from '../../queue/appointment-queue.js';
import { listAppointments } from '../list-appointments/index.js';
import { createAppointment } from './create-appointment.service.js';

// Restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted bare-factory `vi.mock` both (a) deletes every
// export it omits for every later file and (b) silently misses whenever an
// earlier file already imported the real module. Spies are installed at run
// time and restored, so neither hazard applies. Both targets are re-exported
// through a barrel (`../../queue/index.js`,
// `.../resolve-availability/index.js`) — barrels expose live getters that
// cannot be redefined, so we spy the SOURCE modules the barrels forward to.
let enqueueCalendarSyncSpy: MockInstance;
let resolveAvailabilitySpy: MockInstance;
let loadResourceGateContextSpy: MockInstance;
let pickResourcesForSpy: MockInstance;

describe('createAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // The suite's fixed booking dates live on 2024-03-15; pin "now" to the
    // day before so the Phase 3 past-booking backstop sees them as future.
    vi.useFakeTimers({
      now: new Date('2024-03-14T09:00:00Z'),
      toFake: ['Date'],
    });
    // Calendar sync is enqueued onto the booking worker rather than called
    // inline; stub the queue producer so the test never touches BullMQ/Redis.
    enqueueCalendarSyncSpy = vi
      .spyOn(appointmentQueueModule, 'enqueueCalendarSync')
      .mockResolvedValue(undefined as never);
    resolveAvailabilitySpy = vi
      .spyOn(resolveAvailabilityModule, 'resolveAvailability')
      .mockResolvedValue([] as never);
    // Resource gating defaults OFF here — `null` is the zero-cost path an org
    // with no rooms takes, which is what every pre-existing case in this file
    // asserts. The cases that DO exercise rooms override it explicitly.
    loadResourceGateContextSpy = vi
      .spyOn(resourceGateModule, 'loadResourceGateContext')
      .mockResolvedValue(null);
    pickResourcesForSpy = vi
      .spyOn(resourceGateModule, 'pickResourcesFor')
      .mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    enqueueCalendarSyncSpy.mockRestore();
    resolveAvailabilitySpy.mockRestore();
    loadResourceGateContextSpy.mockRestore();
    pickResourcesForSpy.mockRestore();
  });

  const validInput = {
    title: 'Consultation',
    description: 'Initial consultation meeting',
    startDate: new Date('2024-03-15T10:00:00Z'),
    endDate: new Date('2024-03-15T11:00:00Z'),
    color: 'blue' as const,
    status: 'booked' as const,
    source: 'manual' as const,
    leadId: 'lead_123',
    assignedToId: 'user_123',
    organizationId: 'org_123',
  };

  it('should create an appointment with valid input', async () => {
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    const mockAppointment = {
      id: 'appt_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock: lead exists
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    // Mock: insert returns the created appointment
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe(validInput.title);
      expect(result.data.leadId).toBe(validInput.leadId);
      expect(result.data.organizationId).toBe(validInput.organizationId);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing title', async () => {
    const invalidInput = {
      ...validInput,
      title: '',
    };

    await expectResult(
      createAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing leadId', async () => {
    const invalidInput = {
      ...validInput,
      leadId: '',
    };

    await expectResult(
      createAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      ...validInput,
      organizationId: '',
    };

    await expectResult(
      createAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // The backstop catches a misresolved YEAR (register #208), not legitimate
  // back-entry — a year-ago start is rejected, last week's walk-in is not.
  it('rejects a booking whose year was misresolved, quoting today (Phase 3 backstop)', async () => {
    const result = await createAppointment(mockDb as never, {
      ...validInput,
      startDate: new Date('2023-03-15T10:00:00Z'),
      endDate: new Date('2023-03-15T11:00:00Z'),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      const issues = JSON.stringify(result.error.details ?? {});
      expect(issues).toContain('in the past');
      expect(issues).toContain('today is 2024-03-14');
    }
  });

  it('allows an operator to back-enter last week’s walk-in', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'appt_123',
        startDate: new Date('2024-03-06T10:00:00Z'),
        endDate: new Date('2024-03-06T11:00:00Z'),
      },
    ]);
    const result = await createAppointment(mockDb as never, {
      ...validInput,
      // Eight days before the pinned "now" — well past the old 24h window,
      // and exactly the calendar-UI flow that has no min-date picker.
      startDate: new Date('2024-03-06T10:00:00Z'),
      endDate: new Date('2024-03-06T11:00:00Z'),
    });
    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR when endDate is before startDate', async () => {
    const invalidInput = {
      ...validInput,
      startDate: new Date('2024-03-15T11:00:00Z'),
      endDate: new Date('2024-03-15T10:00:00Z'),
    };

    await expectResult(
      createAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND if lead does not exist', async () => {
    // Mock: no lead found
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createAppointment(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Lead not found');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND if lead belongs to different organization', async () => {
    const _leadInDifferentOrg = {
      id: 'lead_123',
      organizationId: 'different_org',
    };

    // Mock: no lead found (because org filter doesn't match)
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createAppointment(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Lead not found');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should create appointment with optional fields', async () => {
    const inputWithOptionalFields = {
      ...validInput,
      calendarAccountId: 'cal_123',
      externalCalendarEventId: 'ext_123',
    };

    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    const mockAppointment = {
      id: 'appt_123',
      ...inputWithOptionalFields,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(
      mockDb as never,
      inputWithOptionalFields
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.calendarAccountId).toBe('cal_123');
      expect(result.data.externalCalendarEventId).toBe('ext_123');
    }
  });

  it('should use default values for color, status, and source', async () => {
    const minimalInput = {
      title: 'Meeting',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      leadId: 'lead_123',
      assignedToId: 'user_123',
      organizationId: 'org_123',
    };

    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    const mockAppointment = {
      id: 'appt_123',
      ...minimalInput,
      color: 'blue',
      status: 'booked',
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'blue',
        status: 'booked',
        source: 'manual',
      })
    );
  });

  it('should return CONFLICT when overlapping appointment exists', async () => {
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    const conflictingAppointment = {
      id: 'appt_existing',
      title: 'Existing Meeting',
      startDate: new Date('2024-03-15T10:30:00Z'),
      endDate: new Date('2024-03-15T11:30:00Z'),
    };

    // Mock: lead exists
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    // Mock: overlapping appointment found
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      conflictingAppointment
    );

    // A customer-facing (non-manual) booking is rejected on overlap.
    await expectResult(
      createAppointment(mockDb as never, {
        ...validInput,
        source: 'booking_form',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Existing Meeting');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── The conflict message must say WHICH BRANCH (ENG-816) ─────────────────
  //
  // The overlap check is org-wide on purpose — a practitioner cannot be in two
  // cities at once — so the appointment it finds is frequently NOT on the
  // calendar the user is looking at. Without the branch name, "this time is
  // already booked" points at a slot that is visibly empty, which reads as a
  // bug rather than a warning; the rational next click is "Book anyway", and
  // one person ends up booked at two sites in the same half hour.
  //
  // `locationId` is passed explicitly in both cases so the target branch is
  // fixed and the only lookup under test is the branch NAME.

  it('names the branch when the clash is at a DIFFERENT one', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_existing',
      title: 'Skin Consultation',
      startDate: new Date('2024-03-15T10:30:00Z'),
      endDate: new Date('2024-03-15T11:30:00Z'),
      locationId: 'loc_grafton',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      name: 'Lumière — Grafton Street',
    });

    await expectResult(
      createAppointment(mockDb as never, {
        ...validInput,
        source: 'booking_form',
        locationId: 'loc_cork',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Skin Consultation');
      expect(error.message).toContain('at Lumière — Grafton Street');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('does NOT name the branch when the clash is at the SAME one', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_existing',
      title: 'Skin Consultation',
      startDate: new Date('2024-03-15T10:30:00Z'),
      endDate: new Date('2024-03-15T11:30:00Z'),
      locationId: 'loc_cork',
    });

    await expectResult(
      createAppointment(mockDb as never, {
        ...validInput,
        source: 'booking_form',
        locationId: 'loc_cork',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Skin Consultation');
      // The clashing appointment is already on screen; naming the branch here
      // is noise, and the lookup is skipped entirely.
      expect(error.message).not.toContain(' at ');
    });

    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
  });

  // ── ENG-792: a staff-side booking may no longer overlap SILENTLY ──────────
  //
  // Double-booking stays a supported workflow. What is gone is doing it by
  // accident: the calendar used to create the clashing appointment with no
  // warning at all, because `source: 'manual'` (the wire DEFAULT) skipped the
  // overlap check entirely.
  describe('manual double-booking requires explicit consent', () => {
    const manualWithPractitioner = {
      ...validInput,
      practitionerId: 'prac_123',
    };

    const conflicting = {
      id: 'appt_existing',
      title: 'Existing Meeting',
      startDate: new Date('2024-03-15T10:30:00Z'),
      endDate: new Date('2024-03-15T11:30:00Z'),
    };

    it('rejects a manual booking that clashes with the practitioner', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.query.appointment.findFirst.mockResolvedValueOnce(conflicting);

      await expectResult(
        createAppointment(mockDb as never, manualWithPractitioner)
      ).toFailWith((error) => {
        expect(error.code).toBe(ErrorCodes.CONFLICT);
        // The message IS the confirmation prompt the calendar renders, so it
        // has to name what was clashed with.
        expect(error.message).toContain('Existing Meeting');
        expect(error.details?.conflictingAppointmentId).toBe('appt_existing');
      });

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('creates it once the caller confirms, and records the consent', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      // The SAME clash the previous test rejected is still there…
      mockDb.query.appointment.findFirst.mockResolvedValue(conflicting);
      mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
        calendarAccountId: null,
        isActive: true,
        invitationPending: false,
        name: 'Practitioner',
      });
      mockDb.returning.mockResolvedValueOnce([
        { id: 'appt_123', ...manualWithPractitioner },
      ]);

      const result = await createAppointment(mockDb as never, {
        ...manualWithPractitioner,
        allowDoubleBooking: true,
      });

      // …and the booking goes through anyway, because the user said so.
      expect(result.success).toBe(true);
      // The consent is written to the row, which is what keeps a DELIBERATE
      // overlap out of the `appointment_no_overlap` exclusion constraint.
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ allowDoubleBooking: true })
      );
    });

    it('writes allowDoubleBooking = false for an ordinary manual booking', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
      mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
        calendarAccountId: null,
        isActive: true,
        invitationPending: false,
        name: 'Practitioner',
      });
      mockDb.returning.mockResolvedValueOnce([
        { id: 'appt_123', ...manualWithPractitioner },
      ]);

      const result = await createAppointment(
        mockDb as never,
        manualWithPractitioner
      );

      expect(result.success).toBe(true);
      // Manual bookings used to be written with `true` unconditionally, opting
      // every one of them out of the DB backstop. A non-overlapping booking is
      // now protected by it like any other.
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ allowDoubleBooking: false })
      );
    });

    it('does not run an overlap query when there is nobody to double-book', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        { id: 'appt_123', ...validInput },
      ]);

      // No practitioner on a staff booking: `assignedToId` is just whoever is
      // logged in, so checking it would make a receptionist booking two
      // different clients into two different chairs collide with herself.
      const result = await createAppointment(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── ENG-794: an invitee is not a bookable practitioner ────────────────────
  it('refuses to book a practitioner who has not accepted their invitation', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      calendarAccountId: null,
      isActive: true,
      invitationPending: true,
      name: 'Not Joined Yet',
    });

    await expectResult(
      createAppointment(mockDb as never, {
        ...validInput,
        practitionerId: 'prac_invited',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Not Joined Yet');
      expect(error.message).toContain('not accepted');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should skip conflict check for non-scheduled appointments', async () => {
    const nonScheduledInput = {
      ...validInput,
      status: 'completed' as const,
    };

    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    const mockAppointment = {
      id: 'appt_123',
      ...nonScheduledInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, nonScheduledInput);

    expect(result.success).toBe(true);
    // appointment.findFirst should NOT have been called for conflict check
    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should reject a customer-facing booking outside practitioner availability', async () => {
    const mockLead = { id: 'lead_123', organizationId: 'org_123' };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    // No appointment-vs-appointment overlap.
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    // Practitioner is off-shift for the requested slot.
    resolveAvailabilitySpy.mockResolvedValueOnce([
      { practitionerId: 'prac_1', working: [], busy: [] },
    ] as never);

    await expectResult(
      createAppointment(mockDb as never, {
        ...validInput,
        source: 'booking_form',
        practitionerId: 'prac_1',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('availability');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should NOT enforce availability for manual (staff) bookings', async () => {
    const mockLead = { id: 'lead_123', organizationId: 'org_123' };
    const mockAppointment = {
      id: 'appt_123',
      ...validInput,
      practitionerId: 'prac_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, {
      ...validInput,
      source: 'manual',
      practitionerId: 'prac_1',
    });

    expect(result.success).toBe(true);
    // Staff overrides are preserved: availability is never resolved.
    expect(resolveAvailabilitySpy).not.toHaveBeenCalled();
  });

  // --- Multi-service cart ---

  it('back-compat: a single-service booking with no `services` still works', async () => {
    // Already a customer, so the booking's lead-conversion hook is a no-op and
    // this test's insert count stays about line items only.
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      status: 'booked' as const,
    };
    const mockAppointment = {
      id: 'appt_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Exactly one insert (the appointment) — no line-item insert.
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it("stamps converted_at on a lead's first booking", async () => {
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      source: 'meta_lead_form' as const,
      assignedToId: null,
      status: 'new' as const,
      convertedAt: null,
    };
    const mockAppointment = {
      id: 'appt_conv',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const result = await createAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // The conversion hook stamped `converted_at` — the derived stage reads that
    // as `booked`, and no status column is written (the appointment/line-item
    // writes use `.values`; only the conversion stamp uses `.set`).
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ convertedAt: expect.any(Date) })
    );
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'booked' })
    );
  });

  it('writes N line items, sets primary serviceId to the first, and sums duration', async () => {
    // Already booked → conversion hook is a no-op; the two inserts asserted
    // below are the appointment and the line-item batch only.
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      status: 'booked' as const,
    };
    const mockAppointment = {
      id: 'appt_cart',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([mockAppointment]);

    const start = new Date('2024-03-15T10:00:00Z');
    const result = await createAppointment(mockDb as never, {
      title: 'Cart booking',
      startDate: start,
      // No endDate — derived from summed durations (30 + 45 = 75 min).
      leadId: 'lead_123',
      assignedToId: 'user_123',
      organizationId: 'org_123',
      services: [
        {
          serviceId: 'svc_a',
          name: 'Cut',
          durationMinutes: 30,
          priceCents: 2500,
        },
        {
          serviceId: 'svc_b',
          name: 'Colour',
          durationMinutes: 45,
          priceCents: null,
        },
      ],
    });

    expect(result.success).toBe(true);

    // Appointment insert: primary serviceId = first item, endDate = start + 75m.
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'svc_a',
        endDate: new Date('2024-03-15T11:15:00Z'),
      })
    );

    // Two inserts: appointment + the line-item batch.
    expect(mockDb.insert).toHaveBeenCalledTimes(2);

    // Line-item batch: one row per cart item, in order, with snapshots.
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({
        appointmentId: 'appt_cart',
        serviceId: 'svc_a',
        name: 'Cut',
        durationMinutes: 30,
        priceCents: 2500,
        sortOrder: 0,
      }),
      expect.objectContaining({
        appointmentId: 'appt_cart',
        serviceId: 'svc_b',
        name: 'Colour',
        durationMinutes: 45,
        priceCents: null,
        sortOrder: 1,
      }),
    ]);
  });

  it('honours an explicit endDate even when a cart is supplied', async () => {
    const mockLead = { id: 'lead_123', organizationId: 'org_123' };
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'appt_x', startDate: new Date('2024-03-15T10:00:00Z') },
    ]);

    const result = await createAppointment(mockDb as never, {
      title: 'Cart booking',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T12:00:00Z'),
      leadId: 'lead_123',
      assignedToId: 'user_123',
      organizationId: 'org_123',
      services: [
        {
          serviceId: 'svc_a',
          name: 'Cut',
          durationMinutes: 30,
          priceCents: 2500,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        endDate: new Date('2024-03-15T12:00:00Z'),
      })
    );
  });

  it('should handle database errors gracefully', async () => {
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      createAppointment(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });

  // --- Consent forms (ENG-647) ---

  /**
   * Consent submissions used to be created ONLY from the public booking form.
   * A clinic taking most of its bookings by phone, at the desk or through
   * Claire therefore generated consent forms for almost none of them — while
   * the product told them consent was handled. For a legal instrument a
   * partial record is worse than an obviously absent one, because it gets
   * trusted.
   *
   * Claire's direct booking and the voice booking path both route through
   * this service, so covering it here covers all three.
   */
  describe('consent forms', () => {
    let consentSpy: MockInstance;

    beforeEach(() => {
      consentSpy = vi
        .spyOn(consentFormsModule, 'createSubmissionsForAppointment')
        .mockResolvedValue({ success: true, data: { created: 0 } } as never);
    });

    afterEach(() => {
      consentSpy.mockRestore();
    });

    it('creates submissions for a staff-created appointment', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'appt_123',
          ...validInput,
          serviceId: 'svc_1',
          leadId: 'lead_123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await createAppointment(mockDb as never, {
        ...validInput,
        source: 'manual',
      });

      expect(consentSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          appointmentId: 'appt_123',
          leadId: 'lead_123',
          organizationId: 'org_123',
          serviceId: 'svc_1',
        })
      );
    });

    it('skips when the appointment has no service to require forms for', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'appt_123',
          ...validInput,
          serviceId: null,
          leadId: 'lead_123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await createAppointment(mockDb as never, validInput);

      expect(consentSpy).not.toHaveBeenCalled();
    });

    it('still books when consent-form creation fails', async () => {
      // The appointment is already committed; a consent failure is logged,
      // never fatal. Matches the public booking path.
      consentSpy.mockRejectedValueOnce(new Error('consent blew up'));
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'appt_123',
          ...validInput,
          serviceId: 'svc_1',
          leadId: 'lead_123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await createAppointment(mockDb as never, validInput);

      expect(result.success).toBe(true);
    });
  });

  // ── Branch stamping (location redesign, Tier 1 gap 4) ────────────────────
  //
  // Only the dashboard controller injects `locationId`; the voice, Claire and
  // API-key writers do not. A NULL `location_id` is invisible to
  // `listAppointments` (strict `eq`) forever, so the fallback has to live in
  // this service rather than at any call site.
  describe('branch stamping', () => {
    const bookingWithoutBranch = {
      ...validInput,
      // Exactly what book-voice-appointment / book-direct-appointment /
      // POST /v1/appointments send: no locationId at all.
      locationId: undefined,
    };

    const stubLeadAndInsert = () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        organizationId: 'org_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'appt_123',
          ...validInput,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    };

    /** The `locationId` actually written on the appointment INSERT. */
    const stampedLocationId = (): string | null => {
      const call = mockDb.values.mock.calls[0]?.[0] as
        | { locationId?: string | null }
        | undefined;
      return call?.locationId ?? null;
    };

    it('stamps the org default branch when the caller supplies none', async () => {
      stubLeadAndInsert();
      // resolveDefaultLocation: isPrimary DESC, sortOrder ASC → Dublin.
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: 'loc_dublin',
        country: 'IE',
      });

      const result = await createAppointment(
        mockDb as never,
        bookingWithoutBranch
      );

      expect(result.success).toBe(true);
      expect(stampedLocationId()).toBe('loc_dublin');
    });

    it('keeps an explicitly supplied branch and does not resolve a default', async () => {
      stubLeadAndInsert();

      const result = await createAppointment(mockDb as never, {
        ...validInput,
        locationId: 'loc_cork',
      });

      expect(result.success).toBe(true);
      expect(stampedLocationId()).toBe('loc_cork');
      expect(
        mockDb.query.organizationLocation.findFirst
      ).not.toHaveBeenCalled();
    });

    // An org with no locations must still be able to take a booking. Throwing
    // here would turn a pre-existing data gap into a failed booking on the
    // phone/chat path, which no caller can recover from mid-conversation —
    // strictly worse than the row being unfiled. There is also no branch
    // calendar for it to be missing from.
    it('still books for an org with zero locations, writing a null branch', async () => {
      stubLeadAndInsert();
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

      const result = await createAppointment(
        mockDb as never,
        bookingWithoutBranch
      );

      expect(result.success).toBe(true);
      expect(stampedLocationId()).toBeNull();
    });

    // The writer→reader link, which is the actual bug: `listAppointments`
    // filters `location_id = $branch`, and NULL never equals anything. This
    // asserts the value the writer stamped is the value that filter selects.
    it('lands on the branch calendar listAppointments renders', async () => {
      stubLeadAndInsert();
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: 'loc_dublin',
        country: 'IE',
      });

      await createAppointment(mockDb as never, bookingWithoutBranch);
      const written = stampedLocationId();
      expect(written).not.toBeNull();

      // Now build the branch calendar's query and check the row would match.
      // `Once`, NOT a persistent `mockReturnValue`: `clearAllMocks` resets call
      // history but keeps implementations, so a sticky `from` here survives
      // into the resource-allocation suite below and breaks its `.leftJoin`
      // chain — a failure that points at the allocator and is really this line.
      mockDb.from.mockReturnValueOnce({
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      } as never);
      let listWhere: SQL | undefined;
      mockDb.query.appointment.findMany.mockImplementationOnce(
        (config: { where?: SQL }) => {
          listWhere = config.where;
          return Promise.resolve([]);
        }
      );

      await listAppointments(mockDb as never, {
        organizationId: 'org_123',
        locationId: 'loc_dublin',
      });

      expect(listWhere).toBeDefined();
      const { sql, params } = new PgDialect().sqlToQuery(listWhere as SQL);
      expect(sql).toContain('"location_id" = $');
      // Without the fallback the writer stamps null, which no bound branch
      // parameter can ever equal — this is the assertion that fails today.
      expect(params).toContain(written);
    });
  });

  // ── Resource gating (rooms / equipment) ───────────────────────────────────
  describe('resource allocation', () => {
    const mockLead = { id: 'lead_123', organizationId: 'org_123' };
    const mockAppointment = {
      id: 'appt_123',
      serviceId: 'svc_1',
      leadId: 'lead_123',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      assignedToId: 'user_123',
      organizationId: 'org_123',
    };

    it('leaves an org with no room requirements byte-identical', async () => {
      // The rollout-safety guarantee: `loadResourceGateContext` finds nothing,
      // so not one further resource query runs and the result carries empty
      // resource fields.
      mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
      mockDb.returning.mockResolvedValueOnce([mockAppointment]);

      const result = await createAppointment(mockDb as never, {
        ...validInput,
        serviceId: 'svc_1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resources).toEqual([]);
        expect(result.data.resourceWarnings).toEqual([]);
      }
      expect(pickResourcesForSpy).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('refuses an ONLINE booking with no free room, and un-creates the appointment', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
      // No practitioner conflict.
      mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockAppointment]);
      loadResourceGateContextSpy.mockResolvedValue({} as never);
      pickResourcesForSpy.mockReturnValue(null);
      // Diagnosis reads: turnaround, requirements, eligibility, categories,
      // resources, conflicts.
      mockDb.where
        .mockResolvedValueOnce([{ turnaroundMinutes: 0 }])
        .mockResolvedValueOnce([{ categoryId: 'cat_room' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'cat_room', name: 'Treatment room' }])
        .mockResolvedValueOnce([
          { id: 'res_1', name: 'Room 1', categoryId: 'cat_room', capacity: 1 },
        ])
        .mockResolvedValueOnce([
          {
            resourceId: 'res_1',
            start: new Date('2024-03-15T10:00:00Z'),
            end: new Date('2024-03-15T11:00:00Z'),
            appointmentTitle: 'Existing',
          },
        ]);

      await expectResult(
        createAppointment(mockDb as never, {
          ...validInput,
          source: 'booking_form',
          serviceId: 'svc_1',
        })
      ).toFailWith((error) => {
        expect(error.code).toBe(ErrorCodes.CONFLICT);
        expect(error.message).toBe(
          'No Treatment room is available at this time'
        );
      });

      // A customer told "that time isn't available" must not then find a
      // booking in their inbox — the row is compensated away.
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('accepts a MANUAL booking with no free room and returns the warning', async () => {
      mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
      mockDb.returning.mockResolvedValueOnce([mockAppointment]);
      loadResourceGateContextSpy.mockResolvedValue({} as never);
      pickResourcesForSpy.mockReturnValue(null);
      mockDb.where
        .mockResolvedValueOnce([{ turnaroundMinutes: 0 }])
        .mockResolvedValueOnce([{ categoryId: 'cat_room' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'cat_room', name: 'Treatment room' }])
        .mockResolvedValueOnce([
          { id: 'res_1', name: 'Room 1', categoryId: 'cat_room', capacity: 1 },
        ])
        .mockResolvedValueOnce([
          {
            resourceId: 'res_1',
            start: new Date('2024-03-15T10:00:00Z'),
            end: new Date('2024-03-15T11:00:00Z'),
            appointmentTitle: 'Filler — Aoife',
          },
        ]);

      const result = await createAppointment(mockDb as never, {
        ...validInput,
        source: 'manual',
        serviceId: 'svc_1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resources).toEqual([
          { categoryId: 'cat_room', resourceId: 'res_1' },
        ]);
        expect(result.data.resourceWarnings).toHaveLength(1);
        expect(
          result.data.resourceWarnings[0].conflictingAppointmentTitle
        ).toBe('Filler — Aoife');
      }
      // Warned, not blocked — the appointment stands.
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('holds nothing for an appointment created in a non-active status', async () => {
      // The lifecycle invariant says allocations exist only while an
      // appointment is active; creating one already-dead would break it at
      // birth.
      mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
      mockDb.returning.mockResolvedValueOnce([mockAppointment]);
      loadResourceGateContextSpy.mockResolvedValue({} as never);

      const result = await createAppointment(mockDb as never, {
        ...validInput,
        status: 'cancelled',
        serviceId: 'svc_1',
      });

      expect(result.success).toBe(true);
      expect(loadResourceGateContextSpy).not.toHaveBeenCalled();
    });
  });
});
