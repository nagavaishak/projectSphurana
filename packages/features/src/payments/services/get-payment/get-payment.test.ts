import {
  beforeEach,
  createMockDatabase,
  describe,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getPayment } from './get-payment.service.js';

describe('getPayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    paymentId: 'pay_123',
    organizationId: 'org_123',
  };

  const mockPayment = {
    id: 'pay_123',
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'eur',
    status: 'pending',
    description: 'Test payment',
  };

  it('should return payment when found', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(mockPayment);

    await expectResult(getPayment(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.id).toBe('pay_123');
        expect(data.amountCents).toBe(5000);
      }
    );
  });

  it('should return NOT_FOUND when payment does not exist', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(null);

    await expectResult(getPayment(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return VALIDATION_ERROR for missing paymentId', async () => {
    await expectResult(
      getPayment(mockDb as never, { organizationId: 'org_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getPayment(mockDb as never, { paymentId: 'pay_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty paymentId', async () => {
    await expectResult(
      getPayment(mockDb as never, { paymentId: '', organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
