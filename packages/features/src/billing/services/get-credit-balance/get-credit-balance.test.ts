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
import { getCreditBalance } from './get-credit-balance.service.js';

describe('getCreditBalance', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return credit balance when found', async () => {
    const mockBalance = {
      id: 'bal_123',
      organizationId: 'org_123',
      balance: 50000, // 500 credits in precision units
      includedCredits: 100000,
      lastRefillAt: new Date(),
      lowBalanceAlertThreshold: 1000,
      lowBalanceAlertSent: false,
      autoRefillEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(mockBalance);

    const result = await getCreditBalance(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.balance).toBe(50000);
    }
  });

  it('should return NOT_FOUND when balance does not exist', async () => {
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getCreditBalance(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Credit balance not found');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getCreditBalance(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      getCreditBalance(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.creditBalances.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getCreditBalance(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
