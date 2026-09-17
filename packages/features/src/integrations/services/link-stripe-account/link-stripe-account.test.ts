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
import { linkStripeAccount } from './link-stripe-account.service.js';

const mockGetAccountInfo = vi.mocked(mockStripeConnectService.getAccountInfo);
const mockClaimAccount = vi.mocked(mockStripeConnectService.claimAccount);

/**
 * The service's two guards are the whole point of the file, so each is pinned
 * with the failure it prevents: repointing a live connection at a new account,
 * and two workspaces sharing one payout destination.
 */
describe('linkStripeAccount', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    organizationId: 'org-123',
    userId: 'user-456',
    stripeAccountId: 'acct_1ABCdef',
  };

  const account = {
    id: 'acct_1ABCdef',
    email: 'salon@example.com',
    businessName: 'Test Salon',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    country: 'IE',
    defaultCurrency: 'eur',
    requirementsCurrentlyDue: [],
    disabledReason: null,
    accountType: 'standard_oauth' as const,
    linkedOrganizationId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetAccountInfo.mockReset();
    mockClaimAccount.mockReset();
    mockClaimAccount.mockResolvedValue(undefined);
  });

  const stubInsert = (row: Record<string, unknown>) => {
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([row]);
  };

  it('links an unclaimed account, recorded as linked rather than legacy', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    stubInsert({
      id: 'sci-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_1ABCdef',
      accountType: 'standard_linked',
    });

    const result = await linkStripeAccount(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stripeAccountId).toBe('acct_1ABCdef');
    }
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-123',
        stripeAccountId: 'acct_1ABCdef',
        // NOT 'standard_oauth': that value means the legacy integration, and
        // the payments panel replaces the whole status view when it sees it.
        accountType: 'standard_linked',
        defaultCurrency: 'eur',
        isActive: true,
      })
    );
  });

  it('classifies a controller account as such rather than assuming OAuth', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce({
      ...account,
      accountType: 'controller' as const,
    });
    stubInsert({ id: 'sci-1', accountType: 'controller' });

    await linkStripeAccount(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ accountType: 'controller' })
    );
  });

  it('claims the account in Stripe before writing the row', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    stubInsert({ id: 'sci-1' });

    await linkStripeAccount(mockDb as never, validInput);

    expect(mockClaimAccount).toHaveBeenCalledWith('acct_1ABCdef', 'org-123');
    expect(mockClaimAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.insert.mock.invocationCallOrder[0] as number
    );
  });

  it('does NOT write the row when the claim fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    mockClaimAccount.mockRejectedValueOnce(new Error('permission denied'));

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('re-links the SAME account as an update (harmless re-sync)', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'sci-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_1ABCdef',
    });
    mockGetAccountInfo.mockResolvedValueOnce(account);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([{ id: 'sci-1' }]);

    const result = await linkStripeAccount(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses to repoint an org that is already connected elsewhere', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'sci-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_OTHER',
    });

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockGetAccountInfo).not.toHaveBeenCalled();
  });

  it('refuses an account already claimed by another workspace', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce({
      ...account,
      linkedOrganizationId: 'org-999',
    });

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockClaimAccount).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows an account already claimed by THIS workspace', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce({
      ...account,
      linkedOrganizationId: 'org-123',
    });
    stubInsert({ id: 'sci-1' });

    const result = await linkStripeAccount(mockDb as never, validInput);
    expect(result.success).toBe(true);
  });

  it('returns NOT_FOUND when Stripe has no such connected account', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    const stripeError = Object.assign(new Error('No such account'), {
      raw: {},
      statusCode: 404,
      code: 'resource_missing',
    });
    mockGetAccountInfo.mockRejectedValueOnce(stripeError);

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns EXTERNAL_SERVICE_ERROR when Stripe is unreachable', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockRejectedValueOnce(new Error('socket hang up'));

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it.each([
    ['a secret key', 'sk_live_abc123'],
    ['a customer id', 'cus_1ABCdef'],
    ['an empty string', ''],
    ['a half-copied id', 'acct_'],
  ])('rejects %s as a validation error', async (_label, stripeAccountId) => {
    await expectResult(
      linkStripeAccount(mockDb as never, { ...validInput, stripeAccountId })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockGetAccountInfo).not.toHaveBeenCalled();
  });

  it('trims a pasted id with surrounding whitespace', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    stubInsert({ id: 'sci-1' });

    const result = await linkStripeAccount(mockDb as never, {
      ...validInput,
      stripeAccountId: '  acct_1ABCdef\n',
    });

    expect(result.success).toBe(true);
    expect(mockGetAccountInfo).toHaveBeenCalledWith('acct_1ABCdef');
  });

  it('returns INTERNAL_ERROR when the write fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('answers CONFLICT when the unique index catches the race', async () => {
    // Two concurrent links for one acct_ can both pass the metadata guard —
    // it reads Stripe, and nothing there is atomic. The database decides, and
    // the loser must get the same sentence the guard would have given, not a
    // 500 that reads as "the product is broken".
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          cause: {
            code: '23505',
            constraint_name:
              'stripe_connect_integration_stripe_account_id_unique',
          },
        }
      )
    );

    const result = await linkStripeAccount(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/another Borradh workspace/);
    }
  });

  it('still reports INTERNAL_ERROR for an unrelated unique violation', async () => {
    // Narrow on purpose: swallowing every 23505 as "already linked" would
    // report a wrong, confident answer for a constraint this service knows
    // nothing about.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);
    mockGetAccountInfo.mockResolvedValueOnce(account);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        cause: { code: '23505', constraint_name: 'some_other_unique' },
      })
    );

    await expectResult(
      linkStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
