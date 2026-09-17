import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { diagnoseCampaignSchema } from './diagnose-campaign.schema.js';

// ---------------------------------------------------------------------------
// Sibling services (`getHighIntentConversationStats`, `getTroubleshootState`)
// are mocked via non-hoisted `vi.doMock` + dynamic import so nothing leaks
// into the shared module registry (isolate: false). Mirrors the cpl-spike
// trigger test pattern.
// ---------------------------------------------------------------------------

const getHighIntentMock = vi.fn();
const getTroubleshootStateMock = vi.fn();

let diagnoseCampaign: typeof import(
  './diagnose-campaign.service.js'
).diagnoseCampaign;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
  query: { businessProfile: { findFirst: ReturnType<typeof vi.fn> } };
}

function makeDb(opts: {
  insightRow?: Record<string, unknown>;
  serviceRows?: Array<{ serviceId: string }>;
  profile?: unknown;
}): MockDb {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(opts.insightRow ? [opts.insightRow] : [])
    .mockResolvedValueOnce(opts.serviceRows ?? []);
  return {
    execute,
    query: {
      businessProfile: {
        findFirst: vi.fn().mockResolvedValue(opts.profile),
      },
    },
  };
}

describe('diagnoseCampaign', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));

    vi.doMock('../shared/index.js', () => ({
      SPEND_THRESHOLD_EUR: 80,
      hasSpentEnough: (cents: number) => cents >= 8700,
      getHighIntentConversationStats: (
        ...args: Parameters<typeof getHighIntentMock>
      ) => getHighIntentMock(...args),
    }));
    vi.doMock('../get-troubleshoot-state/index.js', () => ({
      getTroubleshootState: (
        ...args: Parameters<typeof getTroubleshootStateMock>
      ) => getTroubleshootStateMock(...args),
    }));

    ({ diagnoseCampaign } = await import('./diagnose-campaign.service.js'));

    getHighIntentMock.mockResolvedValue({
      highIntentCount: 0,
      lastHighIntentAt: null,
      attributedConversations: 0,
    });
    getTroubleshootStateMock.mockResolvedValue({ success: true, data: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../shared/index.js');
    vi.doUnmock('../get-troubleshoot-state/index.js');
    vi.resetModules();
  });

  it('produces a full diagnosis from local data', async () => {
    getHighIntentMock.mockResolvedValueOnce({
      highIntentCount: 3,
      lastHighIntentAt: new Date('2026-06-08T00:00:00.000Z'), // 2 days ago
      attributedConversations: 5,
    });
    getTroubleshootStateMock.mockResolvedValueOnce({
      success: true,
      data: {
        currentRound: 'offer_adjusted',
        escalatedAt: null,
        lastDiagnosedAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    });

    const db = makeDb({
      insightRow: {
        spendCents: 16000, // €160
        spendUsdCents: 17000, // ≥ €80 USD gate
        daysWithData: 8, // €20/day avg
        currency: 'EUR',
      },
      serviceRows: [{ serviceId: 'svc-1' }],
      profile: {
        rankedServices: [
          { serviceId: 'svc-1', rank: 1, offerStrategy: 'price_visible_intro' },
          { serviceId: 'svc-other', rank: 2, offerStrategy: 'switch_service' },
        ],
      },
    });

    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const d = result.data;
    expect(d.spendCents).toBe(16000);
    expect(d.spendUsdCents).toBe(17000);
    expect(d.currency).toBe('EUR');
    expect(d.spentEnough).toBe(true);
    expect(d.spendThresholdEur).toBe(80);
    expect(d.highIntentLeadCount).toBe(3);
    expect(d.daysSinceLastHighIntentLead).toBe(2);
    expect(d.serviceTier).toBe(1); // price_visible_intro → T1
    expect(d.offerStrategy).toBe('price_visible_intro');
    expect(d.avgDailySpendCents).toBe(2000);
    expect(d.budgetBand).toBe('20_plus');
    expect(d.currentRound).toBe('offer_adjusted');
    expect(d.roundsTried).toBe(1);
    expect(d.escalated).toBe(false);
    expect(d.lastDiagnosedAt).toBe('2026-06-09T00:00:00.000Z');
  });

  it('reports spentEnough=false below the €80 USD gate', async () => {
    const db = makeDb({
      insightRow: {
        spendCents: 4000,
        spendUsdCents: 4300, // below 8700
        daysWithData: 4,
        currency: 'EUR',
      },
      serviceRows: [],
    });

    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.spentEnough).toBe(false);
    expect(result.data.serviceTier).toBeNull();
    expect(result.data.offerStrategy).toBeNull();
    expect(result.data.budgetBand).toBe('10_to_19'); // 4000/4 = €10
  });

  it('maps escalated state through', async () => {
    getTroubleshootStateMock.mockResolvedValueOnce({
      success: true,
      data: {
        currentRound: 'creative_refreshed',
        escalatedAt: new Date('2026-06-09T00:00:00.000Z'),
        lastDiagnosedAt: null,
      },
    });
    const db = makeDb({
      insightRow: {
        spendCents: 30000,
        spendUsdCents: 32000,
        daysWithData: 10,
        currency: 'EUR',
      },
      serviceRows: [],
    });

    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currentRound).toBe('creative_refreshed');
    expect(result.data.roundsTried).toBe(2);
    expect(result.data.escalated).toBe(true);
  });

  it('handles a campaign with no insight rows (zero spend)', async () => {
    const db = makeDb({ insightRow: undefined, serviceRows: [] });
    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.spendCents).toBe(0);
    expect(result.data.spentEnough).toBe(false);
    expect(result.data.avgDailySpendCents).toBeNull();
    expect(result.data.budgetBand).toBeNull();
  });

  it('returns VALIDATION_ERROR when metaCampaignId is missing', async () => {
    const db = makeDb({});
    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the insight query throws', async () => {
    const db: MockDb = {
      execute: vi.fn().mockRejectedValueOnce(new Error('db down')),
      query: {
        businessProfile: { findFirst: vi.fn() },
      },
    };
    const result = await diagnoseCampaign(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

describe('diagnoseCampaignSchema — windowDays parsing', () => {
  const base = { organizationId: 'org-1', metaCampaignId: 'cmp-1' };

  it('parses a query-string window into a number', () => {
    expect(
      diagnoseCampaignSchema.parse({ ...base, windowDays: '14' }).windowDays
    ).toBe(14);
  });

  it('still accepts a number', () => {
    expect(
      diagnoseCampaignSchema.parse({ ...base, windowDays: 14 }).windowDays
    ).toBe(14);
  });

  it.each(['', '0', 'abc'])(
    'falls back to the default for %p rather than failing validation',
    (raw) => {
      const parsed = diagnoseCampaignSchema.parse({ ...base, windowDays: raw });
      expect(parsed.windowDays).toBeUndefined();
    }
  );

  it('rejects an out-of-range window', () => {
    expect(
      diagnoseCampaignSchema.safeParse({ ...base, windowDays: '-5' }).success
    ).toBe(false);
    expect(
      diagnoseCampaignSchema.safeParse({ ...base, windowDays: '400' }).success
    ).toBe(false);
  });
});
