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
  const stubColumn = (name: string) => ({ __col: name });
  return {
    sql: sqlTag,
    lead: {
      organizationId: stubColumn('lead.organizationId'),
      createdAt: stubColumn('lead.createdAt'),
    },
    assistantRecommendation: {
      organizationId: stubColumn('assistantRecommendation.organizationId'),
      kind: stubColumn('assistantRecommendation.kind'),
      state: stubColumn('assistantRecommendation.state'),
    },
  };
}

let runLeadVolumeDropTrigger: typeof import(
  './lead-volume-drop.trigger.js'
).runLeadVolumeDropTrigger;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
}

function makeDb(opts: { weekRows?: unknown[] }): MockDb {
  return {
    execute: vi.fn(async () => opts.weekRows ?? []),
  };
}

const okPayload = {
  success: true as const,
  data: {
    title: 'Lead volume dropped this week',
    body: 'Fewer leads came in this week than last. Open me and we can check.',
  },
};

describe('runLeadVolumeDropTrigger', () => {
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

    ({ runLeadVolumeDropTrigger } = await import(
      './lead-volume-drop.trigger.js'
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

  it('creates a recommendation when leads drop >25% with prior-week ≥5', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-drop',
          thisWeekTotal: 5,
          priorWeekTotal: 10, // -50%
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledWith(db, {
      organizationId: 'org-drop',
      kind: 'lead_volume_drop',
      triggerContext: {
        thisWeekTotal: 5,
        priorWeekTotal: 10,
      },
    });
    const [, input] = createRecMock.mock.calls[0];
    expect(input.organizationId).toBe('org-drop');
    expect(input.kind).toBe('lead_volume_drop');
    expect(input.primaryAction).toEqual({
      label: 'Open Claire',
      type: 'navigate',
      target:
        '/assistant?prefill=Lead volume is down this week vs last. Help me figure out what slowed and what to do.',
    });
    expect(input.metadata).toMatchObject({
      thisWeekTotal: 5,
      priorWeekTotal: 10,
      thresholdUsed: 0.25,
    });
  });

  it('skips low-volume orgs (prior week below 5-lead floor) — noise suppression', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-tiny',
          thisWeekTotal: 0,
          priorWeekTotal: 2, // 100% drop, but below floor — noise
        },
        {
          organizationId: 'org-tiny-2',
          thisWeekTotal: 1,
          priorWeekTotal: 4,
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('skips orgs whose drop is at or below the 25% threshold', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-flat',
          thisWeekTotal: 10,
          priorWeekTotal: 10,
        },
        {
          organizationId: 'org-mild-drop',
          thisWeekTotal: 8,
          priorWeekTotal: 10, // exactly -20%, below threshold
        },
        {
          organizationId: 'org-edge',
          thisWeekTotal: 75,
          priorWeekTotal: 100, // exactly -25%, NOT > 0.25
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('idempotent: skips when an active rec already exists for the org+kind', async () => {
    findActiveMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'existing-rec', state: 'active' },
    });

    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-dedupe',
          thisWeekTotal: 3,
          priorWeekTotal: 10,
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('isolates orgs: writes one rec per qualifying org without leaking ids', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-A',
          thisWeekTotal: 5,
          priorWeekTotal: 12, // -58%
        },
        {
          organizationId: 'org-B-low-volume',
          thisWeekTotal: 1,
          priorWeekTotal: 3, // floor blocks
        },
        {
          organizationId: 'org-C',
          thisWeekTotal: 6,
          priorWeekTotal: 20, // -70%
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 2, skipped: 0, failed: 0 });
    }
    const orgIdsSentToCreate = createRecMock.mock.calls.map(
      (call) => (call[1] as { organizationId: string }).organizationId
    );
    expect(orgIdsSentToCreate.sort()).toEqual(['org-A', 'org-C']);
  });

  it('skips an org when payload generation fails', async () => {
    generatePayloadMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'LLM down' },
    });

    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-llm-fail',
          thisWeekTotal: 4,
          priorWeekTotal: 10,
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('coerces postgres bigint counts (string-typed) to numbers', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-bigint',
          thisWeekTotal: '4',
          priorWeekTotal: '12',
        },
      ],
    });

    const result = await runLeadVolumeDropTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
    }
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.thisWeekTotal).toBe(4);
    expect(typeof input.metadata.thisWeekTotal).toBe('number');
    expect(input.metadata.priorWeekTotal).toBe(12);
  });
});
