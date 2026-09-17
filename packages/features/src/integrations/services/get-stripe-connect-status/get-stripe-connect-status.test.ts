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
import { getStripeConnectStatus } from './get-stripe-connect-status.service.js';

describe('getStripeConnectStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the persisted status for a connected org', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      accountType: 'controller',
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      requirementsCurrentlyDue: ['external_account'],
      disabledReason: null,
    });

    await expectResult(
      getStripeConnectStatus(mockDb as never, { organizationId: 'org_123' })
    ).toSucceedWith((data) => {
      expect(data.connected).toBe(true);
      expect(data.accountType).toBe('controller');
      expect(data.chargesEnabled).toBe(true);
      expect(data.requirementsCurrentlyDue).toEqual(['external_account']);
    });
  });

  it('returns a disconnected status when no integration exists', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );
    await expectResult(
      getStripeConnectStatus(mockDb as never, { organizationId: 'org_123' })
    ).toSucceedWith((data) => {
      expect(data.connected).toBe(false);
      expect(data.accountType).toBeNull();
      expect(data.requirementsCurrentlyDue).toEqual([]);
    });
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await getStripeConnectStatus(mockDb as never, {
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
