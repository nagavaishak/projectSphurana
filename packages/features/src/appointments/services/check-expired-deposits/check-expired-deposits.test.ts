import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { checkExpiredDeposits } from './check-expired-deposits.service.js';

describe('checkExpiredDeposits', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should return empty result when no expired deposits exist', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);

    const result = await checkExpiredDeposits(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiredCount).toBe(0);
      expect(result.data.expiredDepositIds).toEqual([]);
    }
  });

  it('should mark expired deposits and their appointments', async () => {
    const expiredDeposits = [
      {
        id: 'dep_1',
        appointmentId: 'appt_1',
        status: 'pending',
        expiresAt: new Date('2024-01-01'),
      },
      {
        id: 'dep_2',
        appointmentId: 'appt_2',
        status: 'pending',
        expiresAt: new Date('2024-01-02'),
      },
    ];

    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce(
      expiredDeposits
    );

    const result = await checkExpiredDeposits(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiredCount).toBe(2);
      expect(result.data.expiredDepositIds).toEqual(['dep_1', 'dep_2']);
    }

    // 2 deposits + 2 appointments = 4 update calls
    expect(mockDb.update).toHaveBeenCalledTimes(4);
  });

  it('should respect batchSize parameter', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);

    const result = await checkExpiredDeposits(mockDb as never, {
      batchSize: 10,
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.appointmentDeposit.findMany).toHaveBeenCalled();
  });

  it('should use default batchSize of 50', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);

    const result = await checkExpiredDeposits(mockDb as never, {});

    expect(result.success).toBe(true);
  });

  it('should continue processing when individual deposit update fails', async () => {
    const expiredDeposits = [
      {
        id: 'dep_1',
        appointmentId: 'appt_1',
        status: 'pending',
        expiresAt: new Date('2024-01-01'),
      },
      {
        id: 'dep_2',
        appointmentId: 'appt_2',
        status: 'pending',
        expiresAt: new Date('2024-01-02'),
      },
    ];

    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce(
      expiredDeposits
    );

    // First deposit update throws, second succeeds
    let updateCallCount = 0;
    mockDb.update.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        throw new Error('Failed to update deposit');
      }
      return mockDb; // chainable
    });

    const result = await checkExpiredDeposits(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiredDepositIds).toContain('dep_2');
      expect(result.data.expiredDepositIds).not.toContain('dep_1');
    }
  });

  it('should return VALIDATION_ERROR for invalid batchSize', async () => {
    await expectResult(
      checkExpiredDeposits(mockDb as never, { batchSize: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointmentDeposit.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for batchSize exceeding max', async () => {
    await expectResult(
      checkExpiredDeposits(mockDb as never, { batchSize: 101 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointmentDeposit.findMany).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database query failure', async () => {
    mockDb.query.appointmentDeposit.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      checkExpiredDeposits(mockDb as never, {})
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
