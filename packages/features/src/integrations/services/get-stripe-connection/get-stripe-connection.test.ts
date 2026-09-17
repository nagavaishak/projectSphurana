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
import { getStripeConnection } from './get-stripe-connection.service.js';

describe('getStripeConnection', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns Stripe connection when it exists', async () => {
    const mockIntegration = {
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      chargesEnabled: true,
      payoutsEnabled: true,
      isActive: true,
    };
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );

    const result = await getStripeConnection(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockIntegration);
    }
  });

  it('returns null when no connection exists', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await getStripeConnection(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getStripeConnection(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
