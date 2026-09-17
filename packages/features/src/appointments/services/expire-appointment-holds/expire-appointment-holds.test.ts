import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { expireAppointmentHolds } from './expire-appointment-holds.service.js';

describe('expireAppointmentHolds', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('releases a hold whose clock has run out', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'appt_1' },
      { id: 'appt_2' },
    ]);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'appt_1' }])
      .mockResolvedValueOnce([{ id: 'appt_2' }]);

    const result = await expireAppointmentHolds(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.releasedCount).toBe(2);
      expect(result.data.releasedAppointmentIds).toEqual(['appt_1', 'appt_2']);
    }

    // Cancelled AND the clock cleared — a cancelled row that kept a stale
    // holdExpiresAt would be re-picked on every tick.
    const written = mockDb.set.mock.calls[0][0];
    expect(written.status).toBe('cancelled');
    expect(written.holdExpiresAt).toBeNull();
  });

  it('counts only the rows the guarded write actually changed', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'appt_1' },
      { id: 'appt_2' },
    ]);
    // appt_2 was confirmed between the read and the write, so its status guard
    // matched nothing — it must not be reported as released.
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'appt_1' }])
      .mockResolvedValueOnce([]);

    const result = await expireAppointmentHolds(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.releasedCount).toBe(1);
      expect(result.data.releasedAppointmentIds).toEqual(['appt_1']);
    }
  });

  it('does nothing when no hold has expired', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await expireAppointmentHolds(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.releasedCount).toBe(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an out-of-range batch size', async () => {
    const result = await expireAppointmentHolds(mockDb as never, {
      batchSize: 5000,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.appointment.findMany).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the read fails', async () => {
    mockDb.query.appointment.findMany.mockRejectedValueOnce(
      new Error('DB down')
    );

    const result = await expireAppointmentHolds(mockDb as never, {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
