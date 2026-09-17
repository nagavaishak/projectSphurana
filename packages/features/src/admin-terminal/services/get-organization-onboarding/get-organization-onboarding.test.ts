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
import { getOrganizationOnboarding } from './get-organization-onboarding.service.js';

/**
 * The screen this feeds is a set of inputs and tickboxes, so "nothing attached"
 * and "we could not read it" render identically — an empty box. These tests pin
 * the difference at the boundary instead.
 */
describe('getOrganizationOnboarding', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValue(null);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue(null);
    mockDb.query.whatsappAccount.findMany.mockResolvedValue([]);
    mockDb.query.metaAdsPage.findMany.mockResolvedValue([]);
  });

  it('reports nulls for an organization with nothing attached', async () => {
    const result = await getOrganizationOnboarding(mockDb as never, {
      organizationId: 'org-123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      subscription: null,
      stripeAccount: null,
      meta: null,
    });
  });

  it('returns the attached subscription and Stripe account', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      status: 'active',
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      stripeAccountId: 'acct_123',
      accountName: 'Glow Salon',
      accountType: 'standard_linked',
      chargesEnabled: true,
      payoutsEnabled: false,
    });

    const result = await getOrganizationOnboarding(mockDb as never, {
      organizationId: 'org-123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.subscription).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      status: 'active',
    });
    expect(result.data.stripeAccount).toMatchObject({
      stripeAccountId: 'acct_123',
      chargesEnabled: true,
      payoutsEnabled: false,
    });
  });

  it('returns the linked Meta pages, ad account and WhatsApp numbers', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'integration-1',
      connectionMethod: 'system_user',
      adAccountId: 'act_1',
      adAccountName: 'Glow Ads',
    });
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      {
        pageId: 'page-1',
        pageName: 'Glow Salon',
        linkedInstagramUsername: 'glowsalon',
      },
    ]);
    mockDb.query.whatsappAccount.findMany.mockResolvedValueOnce([
      { phoneNumber: '+353851234567' },
    ]);

    const result = await getOrganizationOnboarding(mockDb as never, {
      organizationId: 'org-123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.meta).toEqual({
      connectionMethod: 'system_user',
      adAccountId: 'act_1',
      adAccountName: 'Glow Ads',
      pages: [
        {
          pageId: 'page-1',
          pageName: 'Glow Salon',
          instagramUsername: 'glowsalon',
        },
      ],
      whatsappNumbers: ['+353851234567'],
    });
  });

  it('does not read Meta pages when there is no integration to read them for', async () => {
    await getOrganizationOnboarding(mockDb as never, {
      organizationId: 'org-123',
    });

    expect(mockDb.query.metaAdsPage.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing organization id', async () => {
    await expectResult(
      getOrganizationOnboarding(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
