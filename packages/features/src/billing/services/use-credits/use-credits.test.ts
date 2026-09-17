import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import * as billingTypesModule from '../../models/billing.types.js';
import { useCredits } from './use-credits.service.js';

// Restored `vi.spyOn`, NOT `vi.mock`. The old bare-factory
// `vi.mock('../../models/billing.types.js')` DELETED every other export of that
// module (DEFAULT_CREDIT_RATES, the credit/subscription types, …) for every
// later file sharing the worker's module graph under `isolate: false`, and would
// silently miss whenever an earlier file had already imported it. Behaviour is
// preserved exactly — the same fixed rate table the old factory used, which
// deliberately differs from the real DEFAULT_CREDIT_RATES (voice at 10
// credits/min) and which the value assertions below depend on.
let mockGetCreditCost: MockInstance;

describe('useCredits', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetCreditCost = vi
      .spyOn(billingTypesModule, 'getCreditCost')
      .mockImplementation(((channel: string, quantity: number) => {
        const costs: Record<string, number> = {
          sms: 1,
          email: 1,
          voice: 10,
          whatsapp: 2,
        };
        return (costs[channel] || 1) * quantity * 100; // 100 precision units per credit
      }) as never);
  });

  afterEach(() => {
    mockGetCreditCost.mockRestore();
  });

  const validInput = {
    organizationId: 'org_123',
    channel: 'sms' as const,
    quantity: 1,
    referenceId: 'msg_456',
    referenceType: 'sms_message',
    description: 'SMS to lead',
  };

  const existingBalance = {
    id: 'bal_123',
    organizationId: 'org_123',
    balance: 50000, // 500 credits
    includedCredits: 100000,
    lowBalanceAlertThreshold: 1000,
    lowBalanceAlertSent: false,
    autoRefillEnabled: false,
  };

  it('should deduct credits and return result', async () => {
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      existingBalance
    );

    const result = await useCredits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.creditsUsed).toBe(100); // 1 credit = 100 units
      expect(result.data.balanceAfter).toBe(49900);
      expect(result.data.transactionId).toBeDefined();
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should handle voice credits (more expensive)', async () => {
    const voiceInput = {
      ...validInput,
      channel: 'voice' as const,
      quantity: 2, // 2 minutes
    };

    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      existingBalance
    );

    const result = await useCredits(mockDb as never, voiceInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditsUsed).toBe(2000); // 10 credits per minute * 2 minutes * 100 units
      expect(result.data.balanceAfter).toBe(48000);
    }
  });

  it('should return CREDIT_BALANCE_NOT_FOUND when balance does not exist', async () => {
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(null);

    await expectResult(useCredits(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(BillingErrorCodes.CREDIT_BALANCE_NOT_FOUND);
        expect(error.message).toContain('not found');
      }
    );
  });

  it('should return INSUFFICIENT_CREDITS when balance too low', async () => {
    const lowBalance = { ...existingBalance, balance: 50 }; // Only 0.5 credits
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(lowBalance);

    await expectResult(useCredits(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(BillingErrorCodes.INSUFFICIENT_CREDITS);
        expect(error.message).toContain('Insufficient credits');
        expect(error.details?.required).toBe(100);
        expect(error.details?.available).toBe(50);
      }
    );
  });

  it('should deactivate sequences when credits exhausted and auto-refill disabled', async () => {
    const nearZeroBalance = {
      ...existingBalance,
      balance: 100,
      autoRefillEnabled: false,
    };
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      nearZeroBalance
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'seq_1' }, { id: 'seq_2' }]);

    const result = await useCredits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balanceAfter).toBe(0);
    }
    // Verify sequences were deactivated
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should not deactivate sequences when auto-refill is enabled', async () => {
    const nearZeroBalanceWithAutoRefill = {
      ...existingBalance,
      balance: 100,
      autoRefillEnabled: true,
    };
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      nearZeroBalanceWithAutoRefill
    );

    const result = await useCredits(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Sequences should not be deactivated when auto-refill is enabled
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      channel: 'sms' as const,
      quantity: 1,
    };

    await expectResult(
      useCredits(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid channel', async () => {
    const invalidInput = {
      ...validInput,
      channel: 'invalid' as never,
    };

    await expectResult(
      useCredits(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for non-positive quantity', async () => {
    const invalidInput = {
      ...validInput,
      quantity: 0,
    };

    await expectResult(
      useCredits(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      existingBalance
    );
    mockDb.update.mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    await expectResult(useCredits(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(error.message).toBe('Failed to use credits');
      }
    );
  });

  it('should work with default quantity of 1', async () => {
    const inputWithoutQuantity = {
      organizationId: 'org_123',
      channel: 'email' as const,
    };

    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      existingBalance
    );

    const result = await useCredits(mockDb as never, inputWithoutQuantity);

    expect(result.success).toBe(true);
  });

  it('should use default description when not provided', async () => {
    const inputWithoutDescription = {
      organizationId: 'org_123',
      channel: 'sms' as const,
      quantity: 1,
    };

    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      existingBalance
    );

    const result = await useCredits(mockDb as never, inputWithoutDescription);

    expect(result.success).toBe(true);
  });
});
