import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { computeCampaignCac } from './compute-campaign-cac.service.js';

const ORG_ID = 'org_123';
const RANGE = { since: '2026-08-01', until: '2026-08-31' };

/**
 * Local drizzle-shaped mock: this service uses `select().from().where()` as a
 * terminal await, which the shared `createMockDatabase` chain returns `this`
 * from rather than resolving.
 */
const createCacMockDb = () => {
  const selectQueue: unknown[][] = [];
  const selectWhere = vi.fn(async () => selectQueue.shift() ?? []);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const findMany = vi.fn(async () => [] as unknown[]);
  return {
    select,
    from,
    selectWhere,
    selectQueue,
    query: { lead: { findMany, findFirst: vi.fn() } },
  };
};

type Insight = {
  metaCampaignId: string;
  currency: string;
  spend: number;
  spendUsd: number;
  impressions: number;
  clicks: number;
  leads: number;
};

const insight = (
  over: Partial<Insight> & { metaCampaignId: string }
): Insight => ({
  currency: 'EUR',
  spend: 0,
  spendUsd: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  ...over,
});

describe('computeCampaignCac', () => {
  const mockDb = createCacMockDb();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.selectQueue.length = 0;
    mockDb.query.lead.findMany.mockResolvedValue([]);
  });

  it('joins leads to spend on utm_campaign and divides', async () => {
    mockDb.selectQueue.push([
      insight({
        metaCampaignId: 'camp_1',
        spend: 5000,
        spendUsd: 5400,
        leads: 5,
      }),
      insight({
        metaCampaignId: 'camp_1',
        spend: 5000,
        spendUsd: 5400,
        leads: 3,
      }),
      insight({ metaCampaignId: 'camp_2', spend: 2000, spendUsd: 2160 }),
    ]);
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      { id: 'l1', utmCampaign: 'camp_1' },
      { id: 'l2', utmCampaign: 'camp_1' },
      { id: 'l3', utmCampaign: 'camp_1' },
      { id: 'l4', utmCampaign: 'camp_1' },
      { id: 'l5', utmCampaign: 'camp_2' },
    ]);

    const result = await computeCampaignCac(mockDb as never, {
      organizationId: ORG_ID,
      dateRange: RANGE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const camp1 = result.data.campaigns.find(
      (c) => c.metaCampaignId === 'camp_1'
    );
    // €100.00 across two days, four leads → €25.00 each.
    expect(camp1?.spend).toBe(10000);
    expect(camp1?.attributedLeads).toBe(4);
    expect(camp1?.costPerAcquisition).toBe(2500);
    expect(camp1?.currency).toBe('EUR');
    // Meta said 8; we can see only 4 reached us. The gap is the signal.
    expect(camp1?.metaReportedLeads).toBe(8);

    const camp2 = result.data.campaigns.find(
      (c) => c.metaCampaignId === 'camp_2'
    );
    expect(camp2?.costPerAcquisition).toBe(2000);

    expect(result.data.totals.spend).toBe(12000);
    expect(result.data.totals.attributedLeads).toBe(5);
    expect(result.data.totals.costPerAcquisition).toBe(2400);
  });

  it('survives a domain move — the join key is the campaign id, not the host', async () => {
    // Leads booked on `salon.borradh.io` before the move and on `salon.com`
    // after it are indistinguishable here BECAUSE nothing stores the host. If
    // attribution were keyed on the hostname this campaign would split into
    // two, and its CAC would appear to halve on the day of the move.
    const spend = [
      insight({
        metaCampaignId: 'camp_1',
        spend: 8000,
        spendUsd: 8600,
        leads: 4,
      }),
    ];
    const leadsBeforeMove = [
      { id: 'l1', utmCampaign: 'camp_1' },
      { id: 'l2', utmCampaign: 'camp_1' },
    ];
    const leadsAfterMove = [
      { id: 'l3', utmCampaign: 'camp_1' },
      { id: 'l4', utmCampaign: 'camp_1' },
    ];

    mockDb.selectQueue.push(spend);
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      ...leadsBeforeMove,
      ...leadsAfterMove,
    ]);

    const result = await computeCampaignCac(mockDb as never, {
      organizationId: ORG_ID,
      dateRange: RANGE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.campaigns).toHaveLength(1);
    expect(result.data.campaigns[0]?.attributedLeads).toBe(4);
    // €80.00 / 4 = €20.00. Not €40.00, which is what a host-keyed join would
    // report for each of the two halves.
    expect(result.data.campaigns[0]?.costPerAcquisition).toBe(2000);
  });

  it('reports null rather than Infinity for a campaign with no leads', async () => {
    mockDb.selectQueue.push([
      insight({ metaCampaignId: 'camp_1', spend: 5000, spendUsd: 5400 }),
    ]);

    const result = await computeCampaignCac(mockDb as never, {
      organizationId: ORG_ID,
      dateRange: RANGE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.campaigns[0]?.costPerAcquisition).toBeNull();
  });

  it('keeps a campaign that produced leads but has no synced spend', async () => {
    mockDb.selectQueue.push([]);
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      { id: 'l1', utmCampaign: 'camp_unsynced' },
    ]);

    const result = await computeCampaignCac(mockDb as never, {
      organizationId: ORG_ID,
      dateRange: RANGE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.campaigns).toHaveLength(1);
    expect(result.data.campaigns[0]?.attributedLeads).toBe(1);
    expect(result.data.campaigns[0]?.spend).toBe(0);
  });

  it('rejects an inverted date range', async () => {
    const result = await computeCampaignCac(mockDb as never, {
      organizationId: ORG_ID,
      dateRange: { since: '2026-08-31', until: '2026-08-01' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});
