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
import { getSubscription } from './get-subscription.service.js';

describe('getSubscription', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return subscription when found', async () => {
    const mockSubscription = {
      id: 'sub_123',
      organizationId: 'org_123',
      stripeCustomerId: 'cus_abc123',
      stripeSubscriptionId: 'sub_stripe_123',
      status: 'active',
      planId: 'pro',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      mockSubscription
    );

    const result = await getSubscription(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.status).toBe('active');
      expect(result.data.planId).toBe('pro');
    }
  });

  it('should return NOT_FOUND when subscription does not exist', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    await expectResult(getSubscription(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toBe('Subscription not found');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getSubscription(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      getSubscription(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.subscriptions.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getSubscription(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
