import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { getCampaignCurrency } from './get-campaign-currency.service.js';

/**
 * The budget shown on every ad card is formatted with the symbol this service
 * returns. A wrong symbol over a true number ("€15.00/day" on a campaign
 * really spending $15/day) is the same class of defect as a wrong number —
 * register #82 — so the resolution order is pinned here rather than left to
 * whatever default a caller happens to pick.
 */
const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN_ID = '120200000000000001';

const findFirst = vi.fn();
const limit = vi.fn();

const mockDb = {
  query: { metaCampaignConfig: { findFirst } },
  // `getOrgCountry`'s builder chain.
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit,
};

const orgCountry = (country: string | null) =>
  limit.mockResolvedValueOnce(country === null ? [] : [{ country }]);

describe('getCampaignCurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
  });

  it('prefers the stored ad-account currency — the account that gets billed', async () => {
    findFirst.mockResolvedValueOnce({
      metaCampaignId: CAMPAIGN_ID,
      organizationId: ORG_ID,
      adAccountCurrency: 'USD',
    });

    const result = await getCampaignCurrency(mockDb as never, {
      organizationId: ORG_ID,
      metaCampaignId: CAMPAIGN_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currencyCode).toBe('USD');
    expect(result.data.currencySymbol).toBe('$');
    expect(result.data.source).toBe('campaign');
  });

  it('falls back to the ORG country when the config row stored no currency', async () => {
    findFirst.mockResolvedValueOnce({
      metaCampaignId: CAMPAIGN_ID,
      organizationId: ORG_ID,
      adAccountCurrency: null,
    });
    orgCountry('us');

    const result = await getCampaignCurrency(mockDb as never, {
      organizationId: ORG_ID,
      metaCampaignId: CAMPAIGN_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currencySymbol).toBe('$');
    expect(result.data.currencyCode).toBe('USD');
    expect(result.data.source).toBe('organization');
  });

  // Campaigns made in Ads Manager (or predating the integration) have NO
  // config row, yet `listCampaigns` returns them and they are editable. They
  // must still render a budget, in the org's own currency — not a 404, and
  // not a blanket euro.
  it('resolves a campaign with NO config row from the org country', async () => {
    findFirst.mockResolvedValueOnce(undefined);
    orgCountry('gb');

    const result = await getCampaignCurrency(mockDb as never, {
      organizationId: ORG_ID,
      metaCampaignId: CAMPAIGN_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currencySymbol).toBe('£');
    expect(result.data.currencyCode).toBe('GBP');
    expect(result.data.source).toBe('organization');
  });

  it('falls back to EUR when the org has no country on file', async () => {
    findFirst.mockResolvedValueOnce(undefined);
    orgCountry(null);

    const result = await getCampaignCurrency(mockDb as never, {
      organizationId: ORG_ID,
      metaCampaignId: CAMPAIGN_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currencySymbol).toBe('€');
  });
});
