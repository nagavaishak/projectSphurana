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
import { listPayments } from './list-payments.service.js';

describe('listPayments', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  const mockPayments = [
    {
      id: 'pay_1',
      organizationId: 'org_123',
      amountCents: 5000,
      status: 'pending',
    },
    {
      id: 'pay_2',
      organizationId: 'org_123',
      amountCents: 3000,
      status: 'paid',
    },
  ];

  it('should list payments for an organization', async () => {
    mockDb.query.payment.findMany.mockResolvedValueOnce(mockPayments);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 2 }]);

    await expectResult(listPayments(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(2);
        expect(data.total).toBe(2);
        expect(data.limit).toBe(20);
        expect(data.offset).toBe(0);
      }
    );
  });

  it('should return empty list when no payments exist', async () => {
    mockDb.query.payment.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(listPayments(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(0);
        expect(data.total).toBe(0);
      }
    );
  });

  it('should apply custom limit and offset', async () => {
    mockDb.query.payment.findMany.mockResolvedValueOnce([mockPayments[0]]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 2 }]);

    await expectResult(
      listPayments(mockDb as never, {
        ...validInput,
        limit: 1,
        offset: 1,
      })
    ).toSucceedWith((data) => {
      expect(data.limit).toBe(1);
      expect(data.offset).toBe(1);
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listPayments(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid limit', async () => {
    await expectResult(
      listPayments(mockDb as never, { ...validInput, limit: 200 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    await expectResult(
      listPayments(mockDb as never, { ...validInput, offset: -1 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should accept optional status filter', async () => {
    mockDb.query.payment.findMany.mockResolvedValueOnce([mockPayments[1]]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 1 }]);

    await expectResult(
      listPayments(mockDb as never, { ...validInput, status: 'paid' })
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  it('should accept optional leadId filter', async () => {
    mockDb.query.payment.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(
      listPayments(mockDb as never, { ...validInput, leadId: 'lead_456' })
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(0);
    });
  });
});
