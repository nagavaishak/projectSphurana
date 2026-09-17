import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { ensureControllerAccount } from './ensure-controller-account.service.js';

describe('ensureControllerAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_1',
    userEmail: 'owner@example.com',
  };

  it('reuses an existing integration row (idempotent, dual-path)', async () => {
    const existing = {
      id: 'int_1',
      organizationId: 'org_123',
      stripeAccountId: 'acct_legacy',
      accountType: 'standard_oauth',
    };
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      existing
    );

    await expectResult(
      ensureControllerAccount(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.stripeAccountId).toBe('acct_legacy');
      expect(data.accountType).toBe('standard_oauth');
    });
    expect(
      mockStripeConnectService.createControllerAccount
    ).not.toHaveBeenCalled();
  });

  it('creates a controller account with prefill when none exists', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
      name: 'Glow Clinic',
      websiteUrl: 'https://glow.example',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      country: 'us',
      isPrimary: true,
    });
    mockStripeConnectService.createControllerAccount.mockResolvedValueOnce({
      accountId: 'acct_new',
      account: {
        id: 'acct_new',
        email: null,
        businessName: 'Glow Clinic',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        country: 'US',
        defaultCurrency: 'usd',
      },
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'int_1',
        organizationId: 'org_123',
        stripeAccountId: 'acct_new',
        accountType: 'controller',
      },
    ]);

    await expectResult(
      ensureControllerAccount(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.accountType).toBe('controller');
    });

    const createArgs =
      mockStripeConnectService.createControllerAccount.mock.calls[0][0];
    expect(createArgs.country).toBe('US');
    expect(createArgs.defaultCurrency).toBe('usd');
    expect(createArgs.businessName).toBe('Glow Clinic');
    expect(createArgs.email).toBe('owner@example.com');
    // Idempotency key keyed on org prevents duplicate acct_ objects (L4).
    expect(createArgs.idempotencyKey).toBe('controller-account:org_123');

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.accountType).toBe('controller');
    expect(inserted.stripeAccountId).toBe('acct_new');
  });

  it('reconciles when a concurrent request already created the row (L4)', async () => {
    // No existing row on the initial check…
    mockDb.query.stripeConnectIntegration.findFirst
      .mockResolvedValueOnce(undefined)
      // …but the concurrent creator's row is found on the reconcile re-read.
      .mockResolvedValueOnce({
        id: 'int_concurrent',
        organizationId: 'org_123',
        stripeAccountId: 'acct_concurrent',
        accountType: 'controller',
      });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
      name: 'Glow Clinic',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      country: 'ie',
      isPrimary: true,
    });
    mockStripeConnectService.createControllerAccount.mockResolvedValueOnce({
      accountId: 'acct_new',
      account: {
        id: 'acct_new',
        email: null,
        businessName: 'Glow Clinic',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        country: 'IE',
        defaultCurrency: 'eur',
      },
    });
    // onConflictDoNothing swallowed the insert — no row returned.
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      ensureControllerAccount(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.stripeAccountId).toBe('acct_concurrent');
    });
  });

  it('returns NOT_FOUND when the organization is missing', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await ensureControllerAccount(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR when Stripe fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
      name: 'Glow Clinic',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockStripeConnectService.createControllerAccount.mockRejectedValueOnce(
      new Error('stripe down')
    );

    const result = await ensureControllerAccount(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
