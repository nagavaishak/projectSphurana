import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { releaseAppointmentResources } from './release-appointment-resources.js';

describe('releaseAppointmentResources', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    for (const method of [mockDb.delete, mockDb.where]) {
      method.mockReset().mockReturnThis();
    }
    mockDb.returning.mockReset().mockResolvedValue([]);
  });

  const validInput = { appointmentId: 'appt_1', organizationId: 'org_1' };

  it('deletes the appointment holds and reports how many', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'ar_1' }, { id: 'ar_2' }]);

    const result = await releaseAppointmentResources(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.releasedCount).toBe(2);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('is idempotent — releasing an appointment that holds nothing succeeds', async () => {
    // Every queue-driven caller (deposit expiry, hold expiry, Stripe webhook
    // redelivery) can run twice; a second release must not be an error.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await releaseAppointmentResources(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.releasedCount).toBe(0);
  });

  it('returns VALIDATION_ERROR without touching the database', async () => {
    await expectResult(
      releaseAppointmentResources(mockDb as never, {
        appointmentId: '',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the delete fails', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('connection lost'));

    await expectResult(
      releaseAppointmentResources(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
