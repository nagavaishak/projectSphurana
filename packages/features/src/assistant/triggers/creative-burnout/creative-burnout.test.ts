import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false): see cpl-spike.test.ts. We register the
// database stub + sibling-service mocks with `vi.doMock` (non-hoisted, scoped)
// and dynamically import the trigger inside `beforeEach`, so nothing leaks
// into the shared module registry.
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
      frequency: stubColumn('metaCampaignDailyInsights.frequency'),
    },
    assistantRecommendation: {
      organizationId: stubColumn('assistantRecommendation.organizationId'),
      kind: stubColumn('assistantRecommendation.kind'),
      state: stubColumn('assistantRecommendation.state'),
    },
  };
}

let runCreativeBurnoutTrigger: typeof import(
  './creative-burnout.trigger.js'
).runCreativeBurnoutTrigger;

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
    title: 'Time to refresh your ad creative',
    body: 'Your audience is seeing the same ad too often.',
  },
};

describe('runCreativeBurnoutTrigger', () => {
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

    ({ runCreativeBurnoutTrigger } = await import(
      './creative-burnout.trigger.js'
    ));

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

  it('creates a recommendation when avg frequency exceeds 3.5', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-burnt',
          metaCampaignId: 'meta-cmp-1',
          avgFrequency: 4.2,
          daysWithData: 14,
        },
      ],
    });

    const result = await runCreativeBurnoutTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledWith(db, {
      organizationId: 'org-burnt',
      kind: 'creative_burnout',
      triggerContext: {
        metaCampaignId: 'meta-cmp-1',
        avgFrequency: 4.2,
        daysWithData: 14,
      },
    });
    const [, input] = createRecMock.mock.calls[0];
    expect(input.organizationId).toBe('org-burnt');
    expect(input.kind).toBe('creative_burnout');
    expect(input.primaryAction).toEqual({
      label: 'Open Claire',
      type: 'navigate',
      target:
        '/assistant?prefill=One of my campaigns has fatigue — what fresh creative should I run next?',
    });
    expect(input.metadata).toMatchObject({
      metaCampaignId: 'meta-cmp-1',
      avgFrequency: 4.2,
      daysWithData: 14,
      thresholdUsed: 3.5,
    });
  });

  it('produces no recommendation when SQL returns no qualifying rows (negative path)', async () => {
    // SQL covers learning-phase + frequency > 3.5 + days_with_data >= 7;
    // empty rows means no org tripped any of those thresholds.
    const db = makeDb({ qualifyingRows: [] });

    const result = await runCreativeBurnoutTrigger(db as never);

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
          avgFrequency: 5.0,
          daysWithData: 12,
        },
      ],
    });

    const result = await runCreativeBurnoutTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('isolates orgs: writes one rec per qualifying org without leaking ids', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-A',
          metaCampaignId: 'meta-cmp-A',
          avgFrequency: 3.6,
          daysWithData: 10,
        },
        {
          organizationId: 'org-B',
          metaCampaignId: 'meta-cmp-B',
          avgFrequency: 4.8,
          daysWithData: 14,
        },
      ],
    });

    const result = await runCreativeBurnoutTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 2, skipped: 0, failed: 0 });
    }
    const orgIdsSentToCreate = createRecMock.mock.calls.map(
      (call) => (call[1] as { organizationId: string }).organizationId
    );
    expect(orgIdsSentToCreate.sort()).toEqual(['org-A', 'org-B']);
  });

  it('learning-phase exclusion is enforced in SQL — the trigger trusts that filter', async () => {
    const db = makeDb({ qualifyingRows: [] });
    await runCreativeBurnoutTrigger(db as never);

    const allRawValues = capturedSqlCalls.flatMap((c) =>
      c.values.filter(
        (v): v is { __raw: string } =>
          typeof v === 'object' && v !== null && '__raw' in v
      )
    );
    expect(allRawValues.some((v) => v.__raw === '10')).toBe(true);
  });

  it('skips an org when payload generation fails', async () => {
    generatePayloadMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'LLM down' },
    });

    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-llm-fail',
          metaCampaignId: 'meta-cmp-1',
          avgFrequency: 4.5,
          daysWithData: 14,
        },
      ],
    });

    const result = await runCreativeBurnoutTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('coerces frequency string ("4.2") into a number on the metadata', async () => {
    const db = makeDb({
      qualifyingRows: [
        {
          organizationId: 'org-string-freq',
          metaCampaignId: 'meta-cmp-1',
          avgFrequency: '4.2',
          daysWithData: '14',
        },
      ],
    });

    const result = await runCreativeBurnoutTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
    }
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.avgFrequency).toBe(4.2);
    expect(typeof input.metadata.avgFrequency).toBe('number');
    expect(input.metadata.daysWithData).toBe(14);
  });
});
