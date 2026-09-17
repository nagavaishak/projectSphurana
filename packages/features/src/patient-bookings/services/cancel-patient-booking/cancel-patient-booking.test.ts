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
import * as notifyPractitionerCancellationModule from '../../../appointments/services/notify-practitioner-cancellation/notify-practitioner-cancellation.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { cancelPatientBooking } from './cancel-patient-booking.service.js';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

const org = (overrides?: Record<string, unknown>) => ({
  id: 'org-1',
  slug: 'glow',
  deletedAt: null,
  timezone: 'Europe/Dublin',
  customerCancellationsEnabled: true,
  cancellationNoticeRequiredHours: 24,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: 2500,
  ...overrides,
});

const appt = (overrides?: Partial<{ startDate: Date; endDate: Date }>) => ({
  id: 'appt-1',
  leadId: 'lead-1',
  organizationId: 'org-1',
  status: 'booked' as const,
  startDate: hoursFromNow(48),
  endDate: hoursFromNow(49),
  serviceId: 'svc-1',
  practitionerId: null,
  deletedAt: null,
  ...overrides,
});

const input = {
  leadId: 'lead-1',
  organizationId: 'org-1',
  appointmentId: 'appt-1',
};

describe('cancelPatientBooking', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let notifySpy: MockInstance;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    // Side effect of the delegated cancel, not the subject here. Restored spy,
    // not vi.mock — see cancel-managed-appointment.test.ts for why.
    notifySpy = vi
      .spyOn(
        notifyPractitionerCancellationModule,
        'notifyPractitionerCancellation'
      )
      .mockResolvedValue({ success: true, data: undefined } as never);
  });

  afterEach(() => {
    notifySpy.mockRestore();
  });

  /** Seed the full happy path: ownership check → token mint → managed cancel. */
  const seedOwnedAndResolvable = (
    appointmentRow: ReturnType<typeof appt> = appt(),
    orgRow: ReturnType<typeof org> = org()
  ) => {
    // 1. Ownership check (patient scope).
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appointmentRow);
    // 2. Org slug + policy lookup (system scope).
    mockDb.query.organization.findFirst.mockResolvedValueOnce(orgRow);
    // 3. resolveManageToken inside the delegated cancel: slug bootstrap …
    mockDb.query.organization.findFirst.mockResolvedValueOnce(orgRow);
    // … token row (the where clause carries the real hash; the mock ignores it) …
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: 'stored-hash',
      expiresAt: hoursFromNow(72),
    });
    // … and the appointment again.
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appointmentRow);
  };

  it('cancels an owned booking by delegating to the appointments service', async () => {
    seedOwnedAndResolvable();
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelPatientBooking(mockDb as never, {
      ...input,
      reason: 'Feeling unwell',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appointmentId).toBe('appt-1');
      expect(result.data.policyAtCancellation.isWithinFreeWindow).toBe(true);
    }

    // A manage token was minted (delegation bridge)…
    expect(mockDb.insert).toHaveBeenCalled();
    // …and the status flip went through the managed cancel's guarded UPDATE.
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(notifySpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt-1',
        cancellationReason: 'Feeling unwell',
      })
    );
  });

  it('returns NOT_FOUND for a booking the patient does not own, and never writes', async () => {
    // Patient-scoped read comes back empty — RLS-invisible or nonexistent,
    // deliberately indistinguishable.
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when appointmentId is missing', async () => {
    const result = await cancelPatientBooking(mockDb as never, {
      ...input,
      appointmentId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('surfaces CONFLICT when the booking is already terminal', async () => {
    seedOwnedAndResolvable();
    // The managed cancel's guarded UPDATE matches no active row.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it('returns FORBIDDEN when the clinic disables online cancellations, and never writes', async () => {
    seedOwnedAndResolvable(
      appt(),
      org({ customerCancellationsEnabled: false })
    );

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe(
        "This clinic doesn't allow online cancellations."
      );
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  /**
   * The notice window is a FEE boundary, not a permission boundary.
   *
   * A patient who cannot come is not going to come because the button was
   * disabled — refusing the cancel just turns a slot the clinic could still
   * refill into a silent no-show, costing them the slot AND the notice. So a
   * late cancel goes through, carrying the clinic's stated fee. Only the
   * TOGGLE blocks (test above). See `evaluateBookingPolicy`.
   */
  it('ALLOWS a late cancellation rather than refusing it', async () => {
    // 24h notice required, appointment only 12h away — strictly past the
    // deadline, and still permitted.
    seedOwnedAndResolvable(
      appt({ startDate: hoursFromNow(12), endDate: hoursFromNow(13) })
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('allows a cancel just before the deadline (boundary: blocked only when now > startDate - notice)', async () => {
    // BOUNDARY CHOICE (see notice-window.ts): allowed iff
    // `now <= startDate - noticeHours`; only strictly PAST the deadline is
    // blocked. An exact-instant fixture would race the real clock, so seed a
    // start a few minutes clear of the 24h deadline instead.
    seedOwnedAndResolvable(
      appt({ startDate: hoursFromNow(24.1), endDate: hoursFromNow(25.1) })
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('applies no notice gate when the required notice is 0 hours', async () => {
    seedOwnedAndResolvable(
      appt({ startDate: hoursFromNow(1), endDate: hoursFromNow(2) }),
      org({ cancellationNoticeRequiredHours: 0 })
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelPatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
  });
});
