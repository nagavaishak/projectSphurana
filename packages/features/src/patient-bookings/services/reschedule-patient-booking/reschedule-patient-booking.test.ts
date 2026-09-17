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
import * as rescheduleEmailModule from '../../../appointments/services/send-reschedule-email/send-reschedule-email.service.js';
import * as slotsModule from '../../../booking-forms/services/get-general-booking-slots/get-general-booking-slots.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { reschedulePatientBooking } from './reschedule-patient-booking.service.js';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

const org = (overrides?: Record<string, unknown>) => ({
  id: 'org-1',
  slug: 'glow',
  deletedAt: null,
  timezone: 'Europe/Dublin',
  customerReschedulingEnabled: true,
  customerCancellationsEnabled: true,
  cancellationNoticeRequiredHours: 0,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: null,
  ...overrides,
});

const appt = (
  overrides?: Partial<{
    serviceId: string | null;
    startDate: Date;
    endDate: Date;
  }>
) => ({
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

describe('reschedulePatientBooking', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let slotsSpy: MockInstance;
  let emailSpy: MockInstance;

  const newStart = hoursFromNow(96);

  const input = {
    leadId: 'lead-1',
    organizationId: 'org-1',
    appointmentId: 'appt-1',
    startTime: newStart,
  };

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    // Slot derivation and the reschedule email belong to their own services;
    // restored spies (not vi.mock) so the shared module graph stays intact.
    slotsSpy = vi
      .spyOn(slotsModule, 'getGeneralBookingSlots')
      .mockResolvedValue({
        success: true,
        data: { slots: [{ startTime: newStart, endTime: hoursFromNow(97) }] },
      } as never);
    emailSpy = vi
      .spyOn(rescheduleEmailModule, 'sendRescheduleEmail')
      .mockResolvedValue({ success: true, data: undefined } as never);
  });

  afterEach(() => {
    slotsSpy.mockRestore();
    emailSpy.mockRestore();
  });

  const seedOwnedAndResolvable = (
    appointmentRow: ReturnType<typeof appt> = appt(),
    orgRow: ReturnType<typeof org> = org()
  ) => {
    // 1. Ownership check (patient scope).
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appointmentRow);
    // 2. Org slug + policy lookup (system scope).
    mockDb.query.organization.findFirst.mockResolvedValueOnce(orgRow);
    // 3. resolveManageToken inside the delegated reschedule.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(orgRow);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: 'stored-hash',
      expiresAt: hoursFromNow(120),
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appointmentRow);
  };

  it('moves an owned booking to an offered slot via the appointments service', async () => {
    seedOwnedAndResolvable();
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appointmentId).toBe('appt-1');
      expect(result.data.startDate.getTime()).toBe(newStart.getTime());
      // Duration preserved (1h booking).
      expect(
        result.data.endDate.getTime() - result.data.startDate.getTime()
      ).toBe(60 * 60 * 1000);
    }
    // The slot gate ran against the real offered-slots service.
    expect(slotsSpy).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('rejects a slot the booking page is not offering', async () => {
    slotsSpy.mockResolvedValue({
      success: true,
      data: { slots: [] },
    } as never);
    seedOwnedAndResolvable();

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a booking the patient does not own, and never writes', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a past start time (delegated gate)', async () => {
    seedOwnedAndResolvable();

    const result = await reschedulePatientBooking(mockDb as never, {
      ...input,
      startTime: hoursFromNow(-1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid startTime', async () => {
    const result = await reschedulePatientBooking(mockDb as never, {
      ...input,
      startTime: new Date('not-a-date'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns FORBIDDEN when the clinic disables online rescheduling, and never writes', async () => {
    seedOwnedAndResolvable(appt(), org({ customerReschedulingEnabled: false }));

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe(
        "This clinic doesn't allow online rescheduling."
      );
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  /**
   * As with cancel, the notice window is a FEE boundary and not a permission
   * boundary — only the clinic's toggle blocks. See `evaluateBookingPolicy`.
   * The move must still land on a slot the booking page actually offers, and
   * that gate is enforced downstream by rescheduleManagedAppointment.
   */
  it('ALLOWS a late reschedule rather than refusing it', async () => {
    // 24h notice required, booking only 6h away — strictly past the deadline,
    // and still permitted.
    seedOwnedAndResolvable(
      appt({ startDate: hoursFromNow(6), endDate: hoursFromNow(7) })
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('applies no notice gate when the org has no rescheduling notice set (null → 0)', async () => {
    seedOwnedAndResolvable(
      appt({ startDate: hoursFromNow(6), endDate: hoursFromNow(7) }),
      org({ reschedulingNoticeRequiredHours: null })
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns CONFLICT when the booking has no service to derive slots from', async () => {
    seedOwnedAndResolvable(appt({ serviceId: null }));

    const result = await reschedulePatientBooking(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
