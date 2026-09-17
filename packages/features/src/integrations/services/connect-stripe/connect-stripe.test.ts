import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
import { connectStripe } from './connect-stripe.service.js';

const mockHandleOAuthCallback = vi.mocked(
  mockStripeConnectService.handleOAuthCallback
);

describe('connectStripe', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockHandleOAuthCallback.mockReset();
  });

  const validInput = {
    organizationId: 'org-123',
    userId: 'user-456',
    code: 'stripe_auth_code',
  };

  const mockAccountResult = {
    accountId: 'acct_123',
    account: {
      businessName: 'Test Business',
      email: 'business@example.com',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    },
  };

  it('connects Stripe successfully (new integration)', async () => {
    mockHandleOAuthCallback.mockResolvedValueOnce(mockAccountResult);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'stripe-1',
        organizationId: 'org-123',
        stripeAccountId: 'acct_123',
        isActive: true,
      },
    ]);

    const result = await connectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stripeAccountId).toBe('acct_123');
    }
  });

  it('updates existing Stripe integration', async () => {
    mockHandleOAuthCallback.mockResolvedValueOnce(mockAccountResult);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'existing-stripe',
      organizationId: 'org-123',
      stripeAccountId: 'acct_old',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'existing-stripe',
        organizationId: 'org-123',
        stripeAccountId: 'acct_123',
        isActive: true,
      },
    ]);

    const result = await connectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  /*
   * DELETED: 'returns VALIDATION_ERROR for mismatched state parameter' and
   * 'returns VALIDATION_ERROR for malformed (non-base64) state'.
   *
   * Both are worth a note rather than a silent removal, because they are a
   * clean specimen of the failure mode `capability-architecture.md` argues is
   * dominant in agent-authored code.
   *
   * The check they exercised compared `state.organizationId` against the
   * `organizationId` argument — but in production BOTH were decoded from the
   * same `state` blob by the controller, so they were always equal and the
   * branch was unreachable. The tests reached it only because the test could
   * pass the two independently, which no caller ever did.
   *
   * So the suite demonstrated a security property the system did not have. Not
   * a mocked-dependency error this time — the mock was fine — but the same
   * shape: the test and the code shared one author's belief, and agreed with
   * each other instead of with reality.
   *
   * State authenticity is now verified by OAuthStateGuard at the entry point,
   * and pinned by packages/features/src/shared/oauth-state.test.ts, which
   * asserts that a forged state is REJECTED — the claim these two only
   * appeared to make.
   */

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      connectStripe(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing code', async () => {
    await expectResult(
      connectStripe(mockDb as never, { ...validInput, code: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when Stripe account not found', async () => {
    mockHandleOAuthCallback.mockRejectedValueOnce(
      new Error('No Stripe account found')
    );

    await expectResult(
      connectStripe(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when CLIENT_ID not configured', async () => {
    mockHandleOAuthCallback.mockRejectedValueOnce(
      new Error('CLIENT_ID is not set')
    );

    await expectResult(
      connectStripe(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected database failure', async () => {
    mockHandleOAuthCallback.mockResolvedValueOnce(mockAccountResult);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      connectStripe(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
