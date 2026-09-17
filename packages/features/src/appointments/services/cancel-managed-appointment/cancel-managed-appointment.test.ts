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
import { ErrorCodes } from '../../../shared/index.js';
import { hashManageToken } from '../../shared/manage-token.js';
import * as notifyPractitionerCancellationModule from '../notify-practitioner-cancellation/notify-practitioner-cancellation.service.js';
import { cancelManagedAppointment } from './cancel-managed-appointment.service.js';

// The practitioner notification is a side effect, not the subject. Stub it so a
// mail failure can't masquerade as a cancellation failure in these tests — and
// so we can assert we still cancel when it blows up.
//
// Restored `vi.spyOn`, NOT `vi.mock`: under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock leaks outward
// (deleting the exports it omits) AND silently misses whenever an earlier file
// already imported the real module. A run-time spy is immune to both.
let notifyPractitionerCancellation: MockInstance;

const RAW_TOKEN = 'raw-token-abc';

const org = {
  id: 'org-1',
  slug: 'glow',
  deletedAt: null,
  customerCancellationsEnabled: true,
  // A CANCEL is judged against the cancellation window. This path used to read
  // the rescheduling column, so the emailed manage link and the portal could
  // disagree about the same booking.
  cancellationNoticeRequiredHours: 24,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: 2500,
};

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

describe('cancelManagedAppointment', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const seedResolvable = (appointmentOverrides?: {
    status?: string;
    startDate?: Date;
  }) => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: hashManageToken(RAW_TOKEN),
      expiresAt: hoursFromNow(72),
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      organizationId: 'org-1',
      status: appointmentOverrides?.status ?? 'booked',
      startDate: appointmentOverrides?.startDate ?? hoursFromNow(48),
      endDate: hoursFromNow(49),
    });
  };

  const input = { organizationSlug: 'glow', token: RAW_TOKEN };

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    notifyPractitionerCancellation = vi
      .spyOn(
        notifyPractitionerCancellationModule,
        'notifyPractitionerCancellation'
      )
      .mockResolvedValue({ success: true, data: undefined } as never);
  });

  afterEach(() => {
    notifyPractitionerCancellation.mockRestore();
  });

  it('cancels an active booking', async () => {
    seedResolvable();
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.appointmentId).toBe('appt-1');
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('reports the policy AS IT STOOD at cancellation', async () => {
    // Inside the 24h window → not free, and the org charges €25.
    seedResolvable({ startDate: hoursFromNow(2) });
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policyAtCancellation.isWithinFreeWindow).toBe(false);
      expect(result.data.policyAtCancellation.lateFeeCents).toBe(2500);
    }
  });

  it('ALLOWS a late cancellation rather than blocking it', async () => {
    // Refusing the cancel would just convert a recoverable slot into a no-show.
    seedResolvable({ startDate: hoursFromNow(1) });
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
  });

  /**
   * The gap this path had: it consulted NO org policy at all.
   *
   * The portal enforced `customerCancellationsEnabled`; the manage link in
   * every confirmation email did not. So a clinic that switched online
   * cancellation off was still being cancelled on by anyone holding one of
   * those emails — including every email sent before the setting existed. The
   * setting was advisory in practice.
   */
  it('refuses when the clinic has switched online cancellation off, and never writes', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      ...org,
      customerCancellationsEnabled: false,
    });
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: hashManageToken(RAW_TOKEN),
      expiresAt: hoursFromNow(72),
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      organizationId: 'org-1',
      status: 'booked',
      startDate: hoursFromNow(48),
      endDate: hoursFromNow(49),
    });

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe(
        "This clinic doesn't allow online cancellations."
      );
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the booking is already terminal', async () => {
    // The status guard is on the UPDATE, so a terminal row matches nothing.
    seedResolvable({ status: 'completed' });
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('still reports success when the practitioner notification fails', async () => {
    // The cancellation is already committed and the slot is already free. A
    // failed email must not tell the patient to cancel again.
    seedResolvable();
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);
    notifyPractitionerCancellation.mockRejectedValueOnce(
      new Error('SMTP down')
    );

    const result = await cancelManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
  });

  it('rejects an invalid token without updating anything', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await cancelManagedAppointment(mockDb as never, {
      organizationSlug: 'glow',
      token: 'bogus',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('passes the patient reason through to the clinic', async () => {
    seedResolvable();
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    await cancelManagedAppointment(mockDb as never, {
      ...input,
      reason: 'Feeling unwell',
    });

    expect(notifyPractitionerCancellation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cancellationReason: 'Feeling unwell' })
    );
  });
});
