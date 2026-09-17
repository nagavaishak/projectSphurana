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
import { voidSale } from './void-sale.service.js';

describe('voidSale', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const openSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    items: [],
    payments: [],
  };

  const validInput = { organizationId: 'org_123', saleId: 'sale_1' };

  it('voids an open sale without settled payments', async () => {
    // Two reads: the preflight validation load + the in-transaction load.
    mockDb.query.sale.findFirst.mockResolvedValue(openSale);
    mockDb.returning.mockResolvedValueOnce([{ ...openSale, status: 'voided' }]);

    await expectResult(voidSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('voided');
      }
    );
  });

  it('rejects voiding a sale with settled payments', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      payments: [{ id: 'pay_1', status: 'succeeded', amountCents: 100 }],
    });
    const result = await voidSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  // A deposit tender is money the APPOINTMENT took at booking, credited here.
  // Treating it as a settled sale tender wedged the sale permanently open:
  // void refused, and no refund path reaches a salePayment row with no payment
  // intent of its own.
  it('voids a sale whose only settled tender is a deposit credit', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...openSale,
      payments: [
        {
          id: 'pay_dep',
          status: 'succeeded',
          method: 'deposit',
          amountCents: 2000,
          appointmentDepositId: 'dep_1',
        },
      ],
    });
    mockDb.returning.mockResolvedValueOnce([{ ...openSale, status: 'voided' }]);

    await expectResult(voidSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('voided');
      }
    );
  });

  // The unique index on appointment_deposit_id means a leftover credit line
  // burns the deposit for every future sale on the same appointment — the
  // customer would be charged the full amount again.
  it('releases the deposit credit so a replacement sale can claim it', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...openSale,
      payments: [
        {
          id: 'pay_dep',
          status: 'succeeded',
          method: 'deposit',
          amountCents: 2000,
          appointmentDepositId: 'dep_1',
        },
      ],
    });
    mockDb.returning.mockResolvedValueOnce([{ ...openSale, status: 'voided' }]);

    await expectResult(voidSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('voided');
      }
    );
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('rejects voiding a non-open sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      status: 'completed',
    });
    const result = await voidSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the sale is missing', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(undefined);
    const result = await voidSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
