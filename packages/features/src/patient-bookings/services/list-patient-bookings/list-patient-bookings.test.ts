import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listPatientBookings } from './list-patient-bookings.service.js';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

const input = { leadId: 'lead-1', organizationId: 'org-1' };

const baseAppt = {
  leadId: 'lead-1',
  organizationId: 'org-1',
  status: 'booked' as const,
  deletedAt: null,
};

describe('listPatientBookings', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  it('splits upcoming (soonest first) from past (most recent first)', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'future-late',
        title: 'Facial',
        startDate: hoursFromNow(72),
        endDate: hoursFromNow(73),
        practitionerId: null,
        serviceId: 'svc-1',
      },
      {
        ...baseAppt,
        id: 'future-soon',
        title: 'Facial',
        startDate: hoursFromNow(24),
        endDate: hoursFromNow(25),
        practitionerId: 'prac-1',
        serviceId: 'svc-1',
      },
      {
        ...baseAppt,
        id: 'past-old',
        title: 'Peel',
        status: 'completed' as const,
        startDate: hoursFromNow(-100),
        endDate: hoursFromNow(-99),
        practitionerId: null,
        serviceId: null,
      },
      {
        ...baseAppt,
        id: 'past-recent',
        title: 'Peel',
        status: 'completed' as const,
        startDate: hoursFromNow(-10),
        endDate: hoursFromNow(-9),
        practitionerId: null,
        serviceId: null,
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'Europe/Dublin',
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', name: 'Dr. Aoife' },
    ]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.upcoming.map((b) => b.id)).toEqual([
      'future-soon',
      'future-late',
    ]);
    expect(result.data.past.map((b) => b.id)).toEqual([
      'past-recent',
      'past-old',
    ]);
    expect(result.data.timezone).toBe('Europe/Dublin');

    const soon = result.data.upcoming[0];
    expect(soon.practitionerName).toBe('Dr. Aoife');
    expect(soon.status).toBe('booked');
    expect(soon.durationMinutes).toBe(60);
  });

  it('computes canCancel / cancelDeadline / canReschedule from the org policy', async () => {
    const start = hoursFromNow(48);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'cancellable',
        title: 'Facial',
        startDate: start,
        endDate: hoursFromNow(49),
        practitionerId: null,
        serviceId: 'svc-1',
      },
      {
        // Past the 24h free-cancellation deadline (12h away). Still offered:
        // the window is a FEE boundary, not a permission boundary.
        ...baseAppt,
        id: 'past-free-window',
        title: 'Peel',
        startDate: hoursFromNow(12),
        endDate: hoursFromNow(13),
        practitionerId: null,
        serviceId: 'svc-1',
      },
      {
        // Terminal status: never actionable, whatever the window says.
        ...baseAppt,
        id: 'already-cancelled',
        title: 'Wax',
        status: 'cancelled' as const,
        startDate: hoursFromNow(72),
        endDate: hoursFromNow(73),
        practitionerId: null,
        serviceId: null,
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
      customerCancellationsEnabled: true,
      cancellationNoticeRequiredHours: 24,
      reschedulingNoticeRequiredHours: 6,
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const byId = new Map(result.data.upcoming.map((b) => [b.id, b]));

    const ok = byId.get('cancellable');
    expect(ok?.canCancel).toBe(true);
    expect(ok?.canReschedule).toBe(true);
    expect(ok?.cancelDeadline).toBe(
      new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString()
    );

    // Past the free window, and STILL offered — this must agree with the
    // mutation gate, which permits a late cancel and reports the fee. If the
    // list said false here the portal would hide a control the server accepts.
    const late = byId.get('past-free-window');
    expect(late?.canCancel).toBe(true);
    expect(late?.canReschedule).toBe(true);
    // The deadline is still reported, so the UI can say the fee now applies.
    expect(late?.cancelDeadline).not.toBeNull();

    const terminal = byId.get('already-cancelled');
    expect(terminal?.canCancel).toBe(false);
    expect(terminal?.canReschedule).toBe(false);
  });

  it('disables cancelling entirely when the clinic turns it off', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'appt-1',
        title: 'Facial',
        startDate: hoursFromNow(96),
        endDate: hoursFromNow(97),
        practitionerId: null,
        serviceId: 'svc-1',
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
      customerCancellationsEnabled: false,
      cancellationNoticeRequiredHours: 24,
      reschedulingNoticeRequiredHours: null,
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      const [booking] = result.data.upcoming;
      expect(booking.canCancel).toBe(false);
      // Disabled cancellations have no deadline to show.
      expect(booking.cancelDeadline).toBe(null);
      // Rescheduling is not gated by the cancellations toggle (null notice → 0).
      expect(booking.canReschedule).toBe(true);
    }
  });

  it('disables rescheduling entirely when the clinic turns it off', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'appt-1',
        title: 'Facial',
        startDate: hoursFromNow(96),
        endDate: hoursFromNow(97),
        practitionerId: null,
        serviceId: 'svc-1',
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
      customerReschedulingEnabled: false,
      customerCancellationsEnabled: true,
      cancellationNoticeRequiredHours: 0,
      reschedulingNoticeRequiredHours: null,
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      const [booking] = result.data.upcoming;
      // Rescheduling is off, so no row is reschedulable regardless of notice.
      expect(booking.canReschedule).toBe(false);
      // Cancelling is not gated by the rescheduling toggle.
      expect(booking.canCancel).toBe(true);
    }
  });

  it('reports no cancel deadline when no notice is required (0h)', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'appt-1',
        title: 'Facial',
        startDate: hoursFromNow(2),
        endDate: hoursFromNow(3),
        practitionerId: null,
        serviceId: 'svc-1',
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
      customerCancellationsEnabled: true,
      cancellationNoticeRequiredHours: 0,
      reschedulingNoticeRequiredHours: 0,
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      const [booking] = result.data.upcoming;
      expect(booking.canCancel).toBe(true);
      expect(booking.cancelDeadline).toBe(null);
      expect(booking.canReschedule).toBe(true);
    }
  });

  it('prefers snapshot line-item names over the appointment title', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      {
        ...baseAppt,
        id: 'appt-1',
        title: 'Old title',
        startDate: hoursFromNow(24),
        endDate: hoursFromNow(25),
        practitionerId: null,
        serviceId: 'svc-1',
      },
    ]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
    });
    // Cart order by sortOrder, not array order.
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([
      { appointmentId: 'appt-1', name: 'Massage', sortOrder: 1 },
      { appointmentId: 'appt-1', name: 'Facial', sortOrder: 0 },
    ]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.upcoming[0].serviceName).toBe('Facial + Massage');
    }
  });

  it('caps past bookings at 20', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({
        ...baseAppt,
        id: `past-${i}`,
        title: 'Visit',
        status: 'completed' as const,
        startDate: hoursFromNow(-(i + 1)),
        endDate: hoursFromNow(-(i + 1) + 0.5),
        practitionerId: null,
        serviceId: null,
      }))
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([]);

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.past).toHaveLength(20);
      // Most recent first.
      expect(result.data.past[0].id).toBe('past-0');
    }
  });

  it('returns empty lists for a patient with no bookings', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      timezone: 'UTC',
    });

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.upcoming).toEqual([]);
      expect(result.data.past).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR when leadId is missing', async () => {
    const result = await listPatientBookings(mockDb as never, {
      leadId: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.appointment.findMany.mockRejectedValueOnce(
      new Error('DB down')
    );

    const result = await listPatientBookings(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
