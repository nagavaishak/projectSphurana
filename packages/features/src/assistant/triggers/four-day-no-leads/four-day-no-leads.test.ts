import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Same isolation strategy as cpl-spike.test.ts: non-hoisted vi.doMock +
// vi.resetModules + dynamic import keep the database stub and the sibling
// service / troubleshoot mocks local to this file (isolate: false).
// ---------------------------------------------------------------------------

const getHighIntentMock = vi.fn();
const advanceStateMock = vi.fn();
const findActiveMock = vi.fn();
const createRecMock = vi.fn();

function makeDatabaseStub() {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  });
  (sqlTag as unknown as { raw: (s: string) => unknown }).raw = (s: string) => ({
    __raw: s,
  });
  return { sql: sqlTag };
}

let runFourDayNoLeadsTrigger: typeof import(
  './four-day-no-leads.trigger.js'
).runFourDayNoLeadsTrigger;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
}

function makeDb(candidateRows: unknown[]): MockDb {
  return { execute: vi.fn(async () => candidateRows) };
}

describe('runFourDayNoLeadsTrigger', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock('@borradh-workspace/database', () => makeDatabaseStub());
    vi.doMock('../../../meta-campaigns/troubleshoot/index.js', () => ({
      SPEND_THRESHOLD_USD_CENTS: 8700,
      getHighIntentConversationStats: (
        ...args: Parameters<typeof getHighIntentMock>
      ) => getHighIntentMock(...args),
      advanceTroubleshootState: (
        ...args: Parameters<typeof advanceStateMock>
      ) => advanceStateMock(...args),
    }));
    vi.doMock(
      '../../services/find-active-recommendation-by-kind/index.js',
      () => ({
        findActiveRecommendationByKind: (
          ...args: Parameters<typeof findActiveMock>
        ) => findActiveMock(...args),
      })
    );
    vi.doMock('../../services/create-recommendation/index.js', () => ({
      createRecommendation: (...args: Parameters<typeof createRecMock>) =>
        createRecMock(...args),
    }));

    ({ runFourDayNoLeadsTrigger } = await import(
      './four-day-no-leads.trigger.js'
    ));

    findActiveMock.mockResolvedValue({ success: true, data: null });
    createRecMock.mockResolvedValue({ success: true, data: { id: 'rec-1' } });
    advanceStateMock.mockResolvedValue({ success: true, data: { id: 's-1' } });
    getHighIntentMock.mockResolvedValue({
      highIntentCount: 0,
      lastHighIntentAt: null,
      attributedConversations: 0,
    });
  });

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/database');
    vi.doUnmock('../../../meta-campaigns/troubleshoot/index.js');
    vi.doUnmock('../../services/find-active-recommendation-by-kind/index.js');
    vi.doUnmock('../../services/create-recommendation/index.js');
    vi.resetModules();
  });

  it('creates one recommendation for a quiet campaign and records state', async () => {
    const db = makeDb([
      {
        organizationId: 'org-quiet',
        metaCampaignId: 'cmp-1',
        spendUsdCents: 12000,
      },
    ]);

    const result = await runFourDayNoLeadsTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    // State recorded with mark_diagnosed for the qualifying campaign.
    expect(advanceStateMock).toHaveBeenCalledWith(db, {
      organizationId: 'org-quiet',
      metaCampaignId: 'cmp-1',
      action: 'mark_diagnosed',
    });
    expect(createRecMock).toHaveBeenCalledTimes(1);
    const [, input] = createRecMock.mock.calls[0];
    expect(input.kind).toBe('campaign_no_leads_4d');
    expect(input.organizationId).toBe('org-quiet');
    expect(input.metadata.metaCampaignId).toBe('cmp-1');
    expect(input.primaryAction.type).toBe('navigate');
  });

  it('skips a campaign that still has high-intent leads', async () => {
    getHighIntentMock.mockResolvedValueOnce({
      highIntentCount: 2,
      lastHighIntentAt: new Date(),
      attributedConversations: 4,
    });
    const db = makeDb([
      {
        organizationId: 'org-active',
        metaCampaignId: 'cmp-1',
        spendUsdCents: 12000,
      },
    ]);

    const result = await runFourDayNoLeadsTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(advanceStateMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('is idempotent — skips when an active rec already exists for the org', async () => {
    findActiveMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'existing', state: 'active' },
    });
    const db = makeDb([
      {
        organizationId: 'org-dupe',
        metaCampaignId: 'cmp-1',
        spendUsdCents: 12000,
      },
    ]);

    const result = await runFourDayNoLeadsTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('writes at most one recommendation per org (highest-spend campaign wins)', async () => {
    const db = makeDb([
      // Same org, two qualifying campaigns — ordered by spend desc by the SQL.
      {
        organizationId: 'org-multi',
        metaCampaignId: 'cmp-big',
        spendUsdCents: 30000,
      },
      {
        organizationId: 'org-multi',
        metaCampaignId: 'cmp-small',
        spendUsdCents: 9000,
      },
    ]);

    const result = await runFourDayNoLeadsTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    // High-intent check + state advance only run for the first (highest-spend)
    // campaign; the second is short-circuited by the per-org guard.
    expect(getHighIntentMock).toHaveBeenCalledTimes(1);
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.metaCampaignId).toBe('cmp-big');
  });

  it('produces no recommendation when there are no qualifying candidates', async () => {
    const db = makeDb([]);
    const result = await runFourDayNoLeadsTrigger(db as never);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(getHighIntentMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });
});
