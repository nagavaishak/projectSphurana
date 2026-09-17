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
import { listDeposits } from './list-deposits.service.js';

describe('listDeposits', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  const mockDeposits = [
    {
      id: 'dep_1',
      appointmentId: 'appt_1',
      organizationId: 'org_123',
      amountCents: 5000,
      currency: 'usd',
      status: 'pending',
      createdAt: new Date('2024-03-15T10:00:00Z'),
    },
    {
      id: 'dep_2',
      appointmentId: 'appt_2',
      organizationId: 'org_123',
      amountCents: 7500,
      currency: 'usd',
      status: 'paid',
      createdAt: new Date('2024-03-14T10:00:00Z'),
    },
  ];

  it('should return list of deposits', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce(
      mockDeposits
    );
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 2 }]),
    });

    const result = await listDeposits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.items[0].id).toBe('dep_1');
    }
  });

  it('should return empty list when no deposits exist', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 0 }]),
    });

    const result = await listDeposits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should filter by appointmentId', async () => {
    const inputWithAppointment = { ...validInput, appointmentId: 'appt_123' };

    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 0 }]),
    });

    const result = await listDeposits(mockDb as never, inputWithAppointment);

    expect(result.success).toBe(true);
    expect(mockDb.query.appointmentDeposit.findMany).toHaveBeenCalled();
  });

  it('should filter by status', async () => {
    const inputWithStatus = { ...validInput, status: 'paid' as const };

    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 0 }]),
    });

    const result = await listDeposits(mockDb as never, inputWithStatus);

    expect(result.success).toBe(true);
    expect(mockDb.query.appointmentDeposit.findMany).toHaveBeenCalled();
  });

  it('should apply pagination with limit and offset', async () => {
    const inputWithPagination = { ...validInput, limit: 10, offset: 20 };

    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 0 }]),
    });

    const result = await listDeposits(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('should use default pagination values', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ total: 0 }]),
    });

    const result = await listDeposits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listDeposits(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid status', async () => {
    await expectResult(
      listDeposits(mockDb as never, {
        ...validInput,
        status: 'invalid_status' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for limit exceeding max', async () => {
    await expectResult(
      listDeposits(mockDb as never, { ...validInput, limit: 101 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    await expectResult(
      listDeposits(mockDb as never, { ...validInput, offset: -1 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
