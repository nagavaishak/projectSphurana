import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/database`, `@borradh-workspace/observability` and the
// sibling recommendation services are canonically mocked / exercised real by
// other files. A hoisted per-file `vi.mock(...)` of any of them installs into
// the SHARED module registry and races with whichever file loads first.
//
// Instead we use `vi.doMock(...)` (non-hoisted, scoped) + `vi.resetModules()`
// + a dynamic `import()` of the trigger inside `beforeEach`. This keeps the
// custom `sql`-capturing database stub and the sibling-service mocks fully
// local to this file — nothing leaks into the shared registry.
// ---------------------------------------------------------------------------

type CapturedSql = {
  strings: TemplateStringsArray;
  values: unknown[];
};
const capturedSqlCalls: CapturedSql[] = [];

const generatePayloadMock = vi.fn();
const findActiveMock = vi.fn();
const createRecMock = vi.fn();

function makeDatabaseStub() {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const captured: CapturedSql & { as: (name: string) => unknown } = {
      strings,
      values,
      as: (_name: string) => captured,
    };
    capturedSqlCalls.push(captured);
    return captured;
  };
  // raw helper used for the inline LEARNING_PHASE_DAYS interpolation.
  (sqlTag as unknown as { raw: (s: string) => unknown }).raw = (s: string) => ({
    __raw: s,
  });
  const stubColumn = (name: string) => ({ __col: name });
  return {
    sql: sqlTag,
    metaCampaignConfig: {
      organizationId: stubColumn('metaCampaignConfig.organizationId'),
      metaCampaignId: stubColumn('metaCampaignConfig.metaCampaignId'),
      createdAt: stubColumn('metaCampaignConfig.createdAt'),
    },
    metaCampaignDailyInsights: {
      organizationId: stubColumn('metaCampaignDailyInsights.organizationId'),
      metaCampaignId: stubColumn('metaCampaignDailyInsights.metaCampaignId'),
      metaAdId: stubColumn('metaCampaignDailyInsights.metaAdId'),
      date: stubColumn('metaCampaignDailyInsights.date'),
      spend: stubColumn('metaCampaignDailyInsights.spend'),
      leads: stubColumn('metaCampaignDailyInsights.leads'),
    },
    assistantRecommendation: {
      organizationId: stubColumn('assistantRecommendation.organizationId'),
      kind: stubColumn('assistantRecommendation.kind'),
      state: stubColumn('assistantRecommendation.state'),
    },
  };
}

let runCplSpikeTrigger: typeof import(
  './cpl-spike.trigger.js'
).runCplSpikeTrigger;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
}

function makeDb(opts: { qualifyingRows?: unknown[] }): MockDb {
  return {
    execute: vi.fn(async () => opts.qualifyingRows ?? []),
  };
}

const okPayload = {
  success: true as const,
  data: {
    title: 'Your CPL is climbing',
    body: "One of your campaigns is paying more per lead than it was last week. Open me and I'll walk you through it.",
  },
};

describe('runCplSpikeTrigger', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    capturedSqlCalls.length = 0;

    vi.doMock('@borradh-workspace/database', () => makeDatabaseStub());
    vi.doMock(
      '../../services/generate-recommendation-payload/index.js',
      () => ({
        generateRecommendationPayload: (
          ...args: Parameters<typeof generatePayloadMock>
        ) => generatePayloadMock(...args),
      })
    );
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

    ({ runCplSpikeTrigger } = await import('./cpl-spike.trigger.js'));

    findActiveMock.mockResolvedValue({ success: true, data: null });
    createRecMock.mockResolvedValue({
      success: true,
      data: { id: 'rec-1' },
    });
    generatePayloadMock.mockResolvedValue(okPayload);
  });

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/database');
    vi.doUnmock('../../services/generate-recommendation-payload/index.js');
    vi.doUnmock('../../services/find-active-recommendation-by-kind/index.js');
    vi.doUnmock('../../services/create-recommendation/index.js');
    vi.resetModules();
  });

  it('creates a recommendation when CPL is up >40% week-over-week', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-spike',
          metaCampaignId: 'meta-cmp-1',
          thisWeekSpendCents: 100_000, // £1000 across 10 leads → £100 CPL
          thisWeekLeads: 10,
          priorWeekSpendCents: 50_000, // £500 across 10 leads → £50 CPL (100% increase)
          priorWeekLeads: 10,
        },
      ],
    });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledWith(db, {
      organizationId: 'org-spike',
      kind: 'cpl_spike',
      triggerContext: {
        metaCampaignId: 'meta-cmp-1',
        thisWeekCplCents: 10_000,
        priorWeekCplCents: 5_000,
      },
    });
    expect(createRecMock).toHaveBeenCalledTimes(1);
    const [, input] = createRecMock.mock.calls[0];
    expect(input.organizationId).toBe('org-spike');
    expect(input.kind).toBe('cpl_spike');
    expect(input.primaryAction).toEqual({
      label: 'Open Claire',
      type: 'navigate',
      target:
        '/assistant?prefill=My cost per lead has jumped this week. Can you walk me through what changed and what I should do about it?',
    });
    expect(input.metadata).toMatchObject({
      metaCampaignId: 'meta-cmp-1',
      thisWeekSpendCents: 100_000,
      thisWeekLeads: 10,
      priorWeekSpendCents: 50_000,
      priorWeekLeads: 10,
    });
  });

  it('produces no recommendation when SQL returns no qualifying rows (negative path)', async () => {
    // SQL filters cover learning-phase + 40% threshold + lead floor; if any
    // of those exclude the org, the row never reaches us. Empty list →
    // empty outcome.
    const db = makeDb({ qualifyingRows: [] });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('idempotent: skips when an active rec already exists for the org+kind', async () => {
    findActiveMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'existing-rec', state: 'active' },
    });

    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-dedupe',
          metaCampaignId: 'meta-cmp-1',
          thisWeekSpendCents: 200_000,
          thisWeekLeads: 5,
          priorWeekSpendCents: 50_000,
          priorWeekLeads: 5,
        },
      ],
    });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledTimes(1);
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('isolates orgs: writes one rec per qualifying org without leaking ids', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-A',
          metaCampaignId: 'meta-cmp-A',
          thisWeekSpendCents: 100_000,
          thisWeekLeads: 10,
          priorWeekSpendCents: 50_000,
          priorWeekLeads: 10,
        },
        {
          organizationId: 'org-B',
          metaCampaignId: 'meta-cmp-B',
          thisWeekSpendCents: 80_000,
          thisWeekLeads: 4,
          priorWeekSpendCents: 40_000,
          priorWeekLeads: 5,
        },
      ],
    });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 2, skipped: 0, failed: 0 });
    }
    const orgIdsSentToCreate = createRecMock.mock.calls.map(
      (call) => (call[1] as { organizationId: string }).organizationId
    );
    expect(orgIdsSentToCreate.sort()).toEqual(['org-A', 'org-B']);
    // Each rec carries its own campaignId — no cross-contamination.
    const campaignIds = createRecMock.mock.calls.map(
      (call) =>
        (call[1] as { metadata: { metaCampaignId: string } }).metadata
          .metaCampaignId
    );
    expect(campaignIds.sort()).toEqual(['meta-cmp-A', 'meta-cmp-B']);
  });

  it('learning-phase exclusion is enforced in SQL — the trigger trusts that filter', async () => {
    // The 10-day learning floor is on `c.created_at < NOW() - INTERVAL '10 days'`
    // inside the CTE-joining SELECT. We can't easily evaluate the SQL here,
    // but we can assert the literal interval interpolation made it into the
    // captured query — guards against the constant being silently dropped.
    const db = makeDb({ qualifyingRows: [] });
    await runCplSpikeTrigger(db as never);

    const allCallStrings = capturedSqlCalls
      .map((c) => c.strings.join(''))
      .join('\n');
    expect(allCallStrings).toContain('NOW() - INTERVAL');
    // sql.raw('10') is rendered into the values array (not the strings),
    // so probe the values too.
    const allRawValues = capturedSqlCalls.flatMap((c) =>
      c.values.filter(
        (v): v is { __raw: string } =>
          typeof v === 'object' && v !== null && '__raw' in v
      )
    );
    expect(allRawValues.some((v) => v.__raw === '10')).toBe(true);
  });

  it('skips an org when payload generation fails (no rec written)', async () => {
    generatePayloadMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'LLM down' },
    });

    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-llm-fail',
          metaCampaignId: 'meta-cmp-1',
          thisWeekSpendCents: 100_000,
          thisWeekLeads: 10,
          priorWeekSpendCents: 50_000,
          priorWeekLeads: 10,
        },
      ],
    });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('coerces postgres bigint counts (string-typed) to numbers', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-bigint',
          metaCampaignId: 'meta-cmp-1',
          thisWeekSpendCents: '100000',
          thisWeekLeads: '10',
          priorWeekSpendCents: '50000',
          priorWeekLeads: '10',
        },
      ],
    });

    const result = await runCplSpikeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
    }
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.thisWeekSpendCents).toBe(100_000);
    expect(typeof input.metadata.thisWeekSpendCents).toBe('number');
    expect(input.metadata.thisWeekLeads).toBe(10);
    expect(typeof input.metadata.thisWeekLeads).toBe('number');
  });
});
