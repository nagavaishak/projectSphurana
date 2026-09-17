import { sendEmail } from '@borradh-workspace/email';
import { createMockDatabase } from '@borradh-workspace/testing';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as createDepositRequestModule from '../../../appointments/services/create-deposit-request/create-deposit-request.service.js';
import * as notifyPractitionerBookingModule from '../../../appointments/services/notify-practitioner-booking/notify-practitioner-booking.service.js';
import * as resolveAvailabilityModule from '../../../scheduling/services/resolve-availability/resolve-availability.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { submitGeneralBooking } from './submit-general-booking.service.js';

// `@borradh-workspace/email` is a canonically-aliased boundary module (see
// vitest.config.ts) — do NOT vi.mock it. Under `isolate: false` a file-local
// vi.mock replaces the shared module object, so other files that captured the
// aliased `sendEmail` at import time record zero calls (e.g. notify-owner-booking
// flaked from exactly this). The alias already stubs `sendEmail` + templates —
// drive it with vi.mocked() in beforeEach.
//
// The two appointment collaborators are INTERNAL modules, so they get RESTORED
// vi.spyOn handles for the same reason: a hoisted vi.mock would leak onto the
// shared graph, and would silently miss once another file has imported the real
// module.

describe('submitGeneralBooking', () => {
  // A FRESH mock db per test. `_resetMocks()` only calls `mockClear()`, which
  // does not drain a queued `mockResolvedValueOnce` — one unconsumed value then
  // surfaces in a later test as an inexplicable failure.
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockCreateDepositRequest: MockInstance;
  let mockNotifyPractitionerBooking: MockInstance;
  let mockResolveAvailability: MockInstance;

  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000); // +30 min

  const validInput = {
    organizationSlug: 'test-salon',
    serviceId: 'svc-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+353871234567',
    appointmentStartTime: futureStart,
    appointmentEndTime: futureEnd,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    // Default: never call through to the real (Stripe-backed) service; tests
    // that exercise the deposit branch queue their own mockResolvedValueOnce.
    mockCreateDepositRequest = vi
      .spyOn(createDepositRequestModule, 'createDepositRequest')
      .mockResolvedValue(undefined as never);
    mockNotifyPractitionerBooking = vi
      .spyOn(notifyPractitionerBookingModule, 'notifyPractitionerBooking')
      .mockResolvedValue(undefined as never);
    // Default: the practitioner is on shift for the whole requested span with
    // nothing blocking it. Tests that care queue their own value.
    mockResolveAvailability = vi
      .spyOn(resolveAvailabilityModule, 'resolveAvailability')
      .mockImplementation((async (
        _db: unknown,
        input: { practitionerIds: string[]; from: Date; to: Date }
      ) =>
        input.practitionerIds.map((practitionerId) => ({
          practitionerId,
          working: [{ start: input.from, end: input.to }],
          busy: [],
        }))) as never);
  });

  afterEach(() => {
    mockCreateDepositRequest.mockRestore();
    mockNotifyPractitionerBooking.mockRestore();
    mockResolveAvailability.mockRestore();
  });

  // --- Validation ---

  it('returns VALIDATION_ERROR for empty first name', async () => {
    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      firstName: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for empty slug', async () => {
    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid email', async () => {
    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      email: 'not-an-email',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when end time is before start time', async () => {
    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      appointmentEndTime: new Date(futureStart.getTime() - 1000),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain(
        'End time must be after start time'
      );
    }
  });

  it('returns VALIDATION_ERROR for past appointment times', async () => {
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pastEnd = new Date(pastStart.getTime() + 30 * 60 * 1000);

    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      appointmentStartTime: pastStart,
      appointmentEndTime: pastEnd,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('past');
    }
  });

  // --- Not found ---

  it('returns NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Organization not found');
    }
  });

  it('returns NOT_FOUND when service does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      primaryCalendarAccountId: null,
      primaryCalendarType: null,
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Service not found');
    }
  });

  it('returns NOT_FOUND when requested practitioner does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      practitionerId: 'non-existent',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Practitioner not found');
    }
  });

  // --- No team member ---

  it('returns INTERNAL_ERROR when no team member available', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    // No practitioner requested, auto-assign
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', organizationId: 'org-1', isActive: true, name: 'Owner' },
    ]);
    // No members found
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(null) // owner lookup
      .mockResolvedValueOnce(null); // any member lookup

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('No team member');
    }
  });

  // --- Availability (the write-side gate) ---

  it('rejects a requested practitioner who is off that day (shift override)', async () => {
    // Regression: the write gate used to check ONLY for an overlapping
    // appointment, so a POST for a day the practitioner had marked as not
    // working was accepted and a real appointment was created. It must agree
    // with the resolver the booking page draws its slots from.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-1',
      organizationId: 'org-1',
      isActive: true,
      name: 'Solo Owner',
    });
    // Day off: no working intervals at all.
    mockResolveAvailability.mockResolvedValueOnce([
      { practitionerId: 'prac-1', working: [], busy: [] },
    ]);

    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      practitionerId: 'prac-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toContain('not available');
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a requested practitioner whose slot is covered by blocked time', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-1',
      organizationId: 'org-1',
      isActive: true,
      name: 'Solo Owner',
    });
    mockResolveAvailability.mockResolvedValueOnce([
      {
        practitionerId: 'prac-1',
        working: [{ start: futureStart, end: futureEnd }],
        busy: [{ start: futureStart, end: futureEnd }],
      },
    ]);

    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      practitionerId: 'prac-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it('auto-assign falls back to the org practitioners when the service has no links', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    // No practitioner_service rows…
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', organizationId: 'org-1', isActive: true, name: 'Owner' },
    ]);
    // …but the org has one active practitioner, who must be considered — and
    // is off that day, so the booking is refused rather than written with a
    // null practitioner that nothing can be checked against.
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      {
        id: 'prac-1',
        organizationId: 'org-1',
        isActive: true,
        name: 'Solo Owner',
      },
    ]);
    mockResolveAvailability.mockResolvedValueOnce([
      { practitionerId: 'prac-1', working: [], busy: [] },
    ]);
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-owner',
      organizationId: 'org-1',
      role: 'owner',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'lead-1' }])
      .mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(mockResolveAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ practitionerIds: ['prac-1'] })
    );
    // …and the booking is refused rather than written unassigned.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses rather than booking unassigned when the org has no practitioners', async () => {
    // There is no org-business-hours fallback any more. An org with nobody to
    // do the work is offered no slots by the read path, and must not be
    // bookable by the write path either — an appointment with a null
    // practitioner is subtracted from nobody's availability, so the same time
    // would simply be offered again.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('auto-assign skips a practitioner who has switched off Calendar bookings', async () => {
    // `accepts_bookings` was written by the team-member editor and read by
    // nobody. Exercised through auto-assign because that is where the rule is
    // applied in memory, over rows already joined from practitioner_service.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          name: 'Solo Owner',
          organizationId: 'org-1',
          isActive: true,
          acceptsBookings: false,
          deletedAt: null,
        },
      },
    ]);
    // Rejected above → the org-level fallback query runs and finds nobody
    // bookable either.
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    // Never even asked whether they were free — they are not offerable at all.
    expect(mockResolveAvailability).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // --- Deposit (per-clinic `depositEnabled` setting) ---

  // Seed a successful booking for a clinic with an active Stripe Connect
  // integration. The deposit branch is reached IFF the org's own
  // `depositEnabled` opt-in is on (controlled via the `depositEnabled` arg).
  function seedDepositHappyPath(depositEnabled = true) {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      primaryCalendarAccountId: null,
      primaryCalendarType: null,
      depositEnabled,
      // Written in lockstep with `depositEnabled` by
      // `updateOrganizationSettings`. The resolver reads THIS, not the toggle —
      // an org row where the two disagree is one the API cannot produce.
      defaultPaymentPolicy: depositEnabled ? 'deposit' : 'in_clinic',
      depositAmount: 2500,
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    // No practitioner requested → auto-assign finds none.
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', organizationId: 'org-1', isActive: true, name: 'Owner' },
    ]);
    // Owner member is the assignee.
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-owner',
      organizationId: 'org-1',
      role: 'owner',
    });
    // Atomic INSERT pair: lead (no existing) then appointment.
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'lead-1' }]) // inserted lead
      .mockResolvedValueOnce([{ id: 'appt-1' }]); // inserted appointment
    // Active Stripe Connect integration so a deposit request can be created.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      organizationId: 'org-1',
      isActive: true,
      chargesEnabled: true,
      defaultCurrency: 'gbp',
    });
  }

  const depositInput = {
    ...validInput,
    bookingPageUrl: 'https://book.example.com/test-salon',
  };

  it('collects a deposit when the clinic has deposits enabled', async () => {
    seedDepositHappyPath();
    mockCreateDepositRequest.mockResolvedValueOnce({
      success: true,
      data: {
        deposit: { amountCents: 2500, currency: 'gbp' },
        checkoutUrl: 'https://checkout.stripe.test/abc',
      },
    } as never);

    const result = await submitGeneralBooking(mockDb as never, depositInput);

    expect(result.success).toBe(true);
    expect(mockCreateDepositRequest).toHaveBeenCalledTimes(1);
    expect(mockCreateDepositRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt-1',
        organizationId: 'org-1',
        amountCents: 2500,
      })
    );
    if (result.success) {
      expect(result.data.deposit).toEqual({
        amountCents: 2500,
        currency: 'gbp',
        checkoutUrl: 'https://checkout.stripe.test/abc',
        // The confirmation screen names the charge from this; without it the
        // page has to guess "deposit" and mislabels a full prepay.
        reason: 'deposit',
      });
    }
  });

  it('skips the deposit when the clinic has deposits disabled', async () => {
    seedDepositHappyPath(false);

    const result = await submitGeneralBooking(mockDb as never, depositInput);

    expect(result.success).toBe(true);
    // depositEnabled is off → no deposit request created.
    expect(mockCreateDepositRequest).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.deposit).toBeNull();
    }
  });

  // --- Multi-service cart ---

  function seedBookingHappyPath() {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      name: 'Test Salon',
      primaryCalendarAccountId: null,
      primaryCalendarType: null,
      depositEnabled: false,
      depositAmount: 0,
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
      name: 'Haircut',
    });
    // No practitioner requested → auto-assign finds none.
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', organizationId: 'org-1', isActive: true, name: 'Owner' },
    ]);
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-owner',
      organizationId: 'org-1',
      role: 'owner',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'lead-1' }]) // inserted lead
      .mockResolvedValueOnce([{ id: 'appt-1' }]); // inserted appointment
  }

  it('back-compat: a single-service booking with no `serviceIds` still works', async () => {
    seedBookingHappyPath();

    const result = await submitGeneralBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // No cart → no organizationService.findMany lookup was issued.
    expect(mockDb.query.organizationService.findMany).not.toHaveBeenCalled();
  });

  it('snapshots the cart into line items and sums the appointment duration', async () => {
    seedBookingHappyPath();
    // The cart lookup (inArray over serviceIds).
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        name: 'Haircut',
        appointmentDuration: 30,
        priceCents: 2500,
      },
      {
        id: 'svc-2',
        organizationId: 'org-1',
        isActive: true,
        name: 'Beard Trim',
        appointmentDuration: 20,
        priceCents: null,
      },
    ]);

    const result = await submitGeneralBooking(mockDb as never, {
      ...validInput,
      serviceIds: ['svc-1', 'svc-2'],
    });

    expect(result.success).toBe(true);

    // Appointment end extended to start + (30 + 20) minutes.
    const expectedEnd = new Date(futureStart.getTime() + 50 * 60_000);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'booking_form',
        serviceId: 'svc-1', // primary stays the single serviceId
        endDate: expectedEnd,
      })
    );
    if (result.success) {
      expect(result.data.appointmentEndTime).toEqual(expectedEnd);
    }

    // Line-item batch snapshotted in cart order.
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({
        appointmentId: 'appt-1',
        serviceId: 'svc-1',
        name: 'Haircut',
        durationMinutes: 30,
        priceCents: 2500,
        sortOrder: 0,
      }),
      expect.objectContaining({
        appointmentId: 'appt-1',
        serviceId: 'svc-2',
        name: 'Beard Trim',
        durationMinutes: 20,
        priceCents: null,
        sortOrder: 1,
      }),
    ]);
  });

  // --- Confirmation email: what the "Manage your booking" link is worth ---

  /**
   * The confirmation goes out at booking time, sometimes weeks ahead, into a
   * channel we do not control — it gets forwarded, sits in shared family
   * mailboxes, and lives in the recipient's backups. So the credential it
   * carries is scoped to the ONE booking it is about, not to the customer's
   * whole record.
   *
   * A portal magic link here would hand whoever opens the message the
   * documents, the signed consent forms and every past and future
   * appointment — and no sane link TTL fits an email that may be read a month
   * after it was sent. Reminders are the opposite case (24h/1h ahead) and do
   * carry a short-lived portal link.
   */
  it('sends an appointment-scoped manage link, never a portal sign-in link', async () => {
    seedDepositHappyPath(false);

    await submitGeneralBooking(mockDb as never, depositInput);

    const confirmation = vi
      .mocked(sendEmail)
      .mock.calls.find(([args]) =>
        String((args as { subject?: string }).subject ?? '').includes(
          'Booking Confirmed'
        )
      );
    expect(confirmation).toBeDefined();

    const props = (confirmation?.[0] as { props: Record<string, unknown> })
      .props;
    expect(props.manageUrl).toEqual(expect.stringContaining('/manage/'));
    // The portal access route is `/portal/{slug}/access?token=…`. Its presence
    // in manageUrl would mean this email grants a portal SESSION.
    expect(props.manageUrl).not.toEqual(expect.stringContaining('/access?'));
  });

  /**
   * BRANCH ADDRESS (phase 3c). `organizationAddress` was declared and rendered
   * on the template with ZERO producers anywhere — the confirmation named a
   * time and a clinic but no place. It now carries the address of the branch
   * the booking actually landed on.
   */
  it("puts the RESOLVED branch's address on the confirmation", async () => {
    seedDepositHappyPath(false);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-cork',
      slug: 'cork',
      name: 'Cork Branch',
      addressLine1: 'Unit 4',
      addressLine2: null,
      city: 'Cork',
      county: null,
      postalCode: 'T12 XY45',
    });

    await submitGeneralBooking(mockDb as never, depositInput);

    const confirmation = vi
      .mocked(sendEmail)
      .mock.calls.find(([args]) =>
        String((args as { subject?: string }).subject ?? '').includes(
          'Booking Confirmed'
        )
      );
    const props = (confirmation?.[0] as { props: Record<string, unknown> })
      .props;
    expect(props.organizationAddress).toBe('Unit 4, Cork, T12 XY45');
  });

  /**
   * An org mid-onboarding with no branch rows at all. The address must be
   * ABSENT, not borrowed — the whole point of resolving per-branch is that a
   * guess sends a Cork patient to Dublin.
   */
  it('omits the address entirely when no branch resolves', async () => {
    seedDepositHappyPath(false);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await submitGeneralBooking(mockDb as never, depositInput);

    const confirmation = vi
      .mocked(sendEmail)
      .mock.calls.find(([args]) =>
        String((args as { subject?: string }).subject ?? '').includes(
          'Booking Confirmed'
        )
      );
    const props = (confirmation?.[0] as { props: Record<string, unknown> })
      .props;
    expect(props.organizationAddress).toBeUndefined();
  });

  // --- Microsite attribution (plan §9, §11) ---
  //
  // A lead with no `microsite_id` and no UTMs is a lead `computeCampaignCac`
  // cannot join to spend, so a booking that came off an ad would report as
  // unattributed forever. These prove the wiring exists, not the attach
  // service's own semantics (covered in attach-lead-attribution.test.ts).

  const BLANK_LEAD_FOR_ATTRIBUTION = {
    id: 'lead-1',
    micrositeId: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
  };

  /** The one `.set()` that wrote attribution, whichever order it happened in. */
  const attributionWrite = () =>
    mockDb.set.mock.calls
      .map(([values]) => values as Record<string, unknown>)
      .find((values) => values && 'micrositeId' in values);

  it('attributes a booking that came from a microsite visit', async () => {
    seedDepositHappyPath(false);
    // The attach service re-reads the lead it is about to tag.
    mockDb.query.lead.findFirst.mockResolvedValueOnce(
      BLANK_LEAD_FOR_ATTRIBUTION
    );

    const result = await submitGeneralBooking(mockDb as never, {
      ...depositInput,
      micrositeId: 'site-1',
      landingUrl:
        'https://salon.com/book/test-salon?ms=site-1&utm_source=meta&utm_medium=paid_social&utm_campaign=camp_1',
    });

    expect(result.success).toBe(true);

    // Fire-and-forget: the booking returns before the write lands.
    await vi.waitFor(() => expect(attributionWrite()).toBeDefined());

    const written = attributionWrite() as Record<string, unknown>;
    expect(written.micrositeId).toBe('site-1');
    expect(written.utmSource).toBe('meta');
    expect(written.utmCampaign).toBe('camp_1');
    // §9: the SITE is the key, never the host — a tenant moving from
    // salon.borradh.io to salon.com must not split their attribution history.
    expect(JSON.stringify(written)).not.toContain('salon.com');
    expect(JSON.stringify(written)).not.toContain('borradh.io');
  });

  it('does not touch attribution for a booking with none', async () => {
    seedDepositHappyPath(false);

    const result = await submitGeneralBooking(mockDb as never, depositInput);

    expect(result.success).toBe(true);
    expect(attributionWrite()).toBeUndefined();
  });

  // ── Which branch a public booking lands at ───────────────────────────────
  // Once the calendar filters by branch, an appointment with a NULL
  // `location_id` appears on NO branch's diary. A public booking that lands in
  // the database and nowhere a human looks is worse than a rejected one — the
  // customer gets a confirmation email for a slot nobody can see. So the
  // general form (which has no branch in its URL) stamps the org's DEFAULT
  // branch, the same one `getGeneralBookingConfig` priced against.

  it('stamps the default branch on the appointment it creates', async () => {
    seedDepositHappyPath(false);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-primary',
      country: 'IE',
    });

    const result = await submitGeneralBooking(mockDb as never, depositInput);

    expect(result.success).toBe(true);
    // Two inserts run: lead, then appointment. Only the appointment carries a
    // branch.
    const appointmentValues = mockDb.values.mock.calls
      .map((call) => call[0])
      .find(
        (value): value is Record<string, unknown> =>
          typeof value === 'object' &&
          value !== null &&
          'locationId' in (value as Record<string, unknown>)
      );
    expect(appointmentValues?.locationId).toBe('loc-primary');
  });

  it('creates a branch-less appointment when the org has no locations', async () => {
    // An org mid-onboarding has no branch to resolve. The booking must still
    // succeed — refusing a paying customer because a settings row is missing
    // would be the worse failure — and the row is repaired by the same
    // backfill that tightens the column.
    seedDepositHappyPath(false);

    const result = await submitGeneralBooking(mockDb as never, depositInput);

    expect(result.success).toBe(true);
    const appointmentValues = mockDb.values.mock.calls
      .map((call) => call[0])
      .find(
        (value): value is Record<string, unknown> =>
          typeof value === 'object' &&
          value !== null &&
          'locationId' in (value as Record<string, unknown>)
      );
    expect(appointmentValues?.locationId).toBeNull();
  });
});
