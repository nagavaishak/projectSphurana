import { getStripeService } from '@borradh-workspace/integrations/stripe';
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
import { resolveBillingCurrency } from './resolve-billing-currency.service.js';

/**
 * Regression coverage for `resolveBillingCurrency`.
 *
 * Bug families pinned:
 *  - Validation gap: empty `organizationId` → VALIDATION_ERROR, not a throw.
 *  - Null/undefined deref + empty-state: when an org has NO Stripe customer
 *    (neither `organization.stripeCustomerId` nor a subscription row), the
 *    `org?.stripeCustomerId ?? subscription?.stripeCustomerId` chain at
 *    resolve-billing-currency.service.ts:69-70 must resolve to `undefined`
 *    and the service must return `{ currency: null }` WITHOUT calling Stripe
 *    (the `if (!customerId)` short-circuit at :73). Pre-guard this would have
 *    dereffed a null org / passed `undefined` into the Stripe call.
 */

const mockStripe = vi.mocked(getStripeService);

describe('resolveBillingCurrency', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Default: org has no location on file (getOrgCountry → null). Tests that
    // exercise country-derived currency override this terminal.
    mockDb.limit.mockResolvedValue([]);
  });

  it('returns VALIDATION_ERROR for an empty organizationId', async () => {
    await expectResult(
      resolveBillingCurrency(mockDb as never, { organizationId: '' })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('returns currency=null and never calls Stripe when no customer exists', async () => {
    // No org row and no subscription row — the no-data empty state.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBeNull();
    }
    // The short-circuit at :73 must avoid the Stripe round-trip entirely.
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('returns currency=null when org exists but has no stripeCustomerId', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      stripeCustomerId: null,
    });
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBeNull();
    }
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('derives EUR from an IE location when no customer is locked yet', async () => {
    // Regression: an Irish org with no Stripe customer must resolve to EUR from
    // its location country, not null (which let the browser locale pick GBP).
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      stripeCustomerId: null,
    });
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockDb.limit.mockResolvedValueOnce([{ country: 'ie' }]);

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('eur');
    }
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('derives GBP from a GB location when no customer is locked yet', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      stripeCustomerId: null,
    });
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockDb.limit.mockResolvedValueOnce([{ country: 'gb' }]);

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('gbp');
    }
    expect(mockStripe).not.toHaveBeenCalled();
  });

  it('derives currency from country when the customer has no locked currency', async () => {
    // The real signup path: orgs get a pre-created Stripe customer, so
    // customerId is set but Stripe's customer.currency is null until the first
    // invoice. Must fall back to the IE location's EUR, not null.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      stripeCustomerId: 'cus_precreated',
    });
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockDb.limit.mockResolvedValueOnce([{ country: 'ie' }]);
    vi.mocked(mockStripe().getCustomerCurrency).mockResolvedValueOnce(null);

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('eur');
    }
    expect(mockStripe().getCustomerCurrency).toHaveBeenCalledWith(
      'cus_precreated'
    );
  });

  it("falls back to the subscription's stripeCustomerId and queries Stripe", async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      stripeCustomerId: null,
    });
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      organizationId: 'org_1',
      stripeCustomerId: 'cus_456',
    });
    vi.mocked(mockStripe().getCustomerCurrency).mockResolvedValueOnce('eur');

    const result = await resolveBillingCurrency(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('eur');
    }
    expect(mockStripe().getCustomerCurrency).toHaveBeenCalledWith('cus_456');
  });
});
