import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expireAppointmentDeposit } from './expire-appointment-deposit.service.js';

// The service locks the deposit row (SELECT … FOR UPDATE) inside a transaction,
// so the locked row is returned via the select chain's terminal `.limit()`.
describe('expireAppointmentDeposit', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const pending = {
    id: 'dep_1',
    appointmentId: 'appt_1',
    organizationId: 'org_1',
    status: 'pending',
  };

  it('expires a pending deposit and cancels its appointment', async () => {
    mockDb.limit.mockResolvedValueOnce([pending]);

    const result = await expireAppointmentDeposit(mockDb as never, {
      depositId: 'dep_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expired).toBe(true);
    // deposit UPDATE + appointment UPDATE
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('no-ops when the deposit is no longer pending', async () => {
    mockDb.limit.mockResolvedValueOnce([{ ...pending, status: 'paid' }]);

    const result = await expireAppointmentDeposit(mockDb as never, {
      depositId: 'dep_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expired).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('no-ops when the deposit is missing', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await expireAppointmentDeposit(mockDb as never, {
      depositId: 'dep_missing',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expired).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for bad input', async () => {
    const result = await expireAppointmentDeposit(mockDb as never, {
      depositId: '',
    });
    expect(result.success).toBe(false);
  });
});
