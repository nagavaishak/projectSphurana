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
    appointment: {
      organizationId: stubColumn('appointment.organizationId'),
      startDate: stubColumn('appointment.startDate'),
      status: stubColumn('appointment.status'),
    },
    assistantRecommendation: {
      organizationId: stubColumn('assistantRecommendation.organizationId'),
      kind: stubColumn('assistantRecommendation.kind'),
      state: stubColumn('assistantRecommendation.state'),
    },
  };
}

let runNoShowSurgeTrigger: typeof import(
  './no-show-surge.trigger.js'
).runNoShowSurgeTrigger;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
}

function makeDb(opts: { weekRows?: unknown[] }): MockDb {
  return {
    execute: vi.fn(async () => opts.weekRows ?? []),
  };
}

const okPayload = (kind: string) => ({
  success: true as const,
  data: {
    title: 'No-show rate is up this week',
    body: `Look at recent no-shows (${kind}) and decide what to do.`,
  },
});

describe('runNoShowSurgeTrigger', () => {
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

    ({ runNoShowSurgeTrigger } = await import('./no-show-surge.trigger.js'));

    findActiveMock.mockResolvedValue({ success: true, data: null });
    createRecMock.mockResolvedValue({
      success: true,
      data: { id: 'rec-1' },
    });
    generatePayloadMock.mockImplementation(async (_db, input) =>
      okPayload(input.kind)
    );
  });

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/database');
    vi.doUnmock('../../services/generate-recommendation-payload/index.js');
    vi.doUnmock('../../services/find-active-recommendation-by-kind/index.js');
    vi.doUnmock('../../services/create-recommendation/index.js');
    vi.resetModules();
  });

  it('creates a recommendation when no-show rate is up >15% with sufficient volume', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-surge',
          thisWeekTotal: 20,
          thisWeekNoShows: 4, // 20%
          lastWeekTotal: 20,
          lastWeekNoShows: 2, // 10% — surge of 100% relative
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledWith(db, {
      organizationId: 'org-surge',
      kind: 'no_show_surge',
    });
    expect(createRecMock).toHaveBeenCalledTimes(1);
    const [, input] = createRecMock.mock.calls[0];
    expect(input.organizationId).toBe('org-surge');
    expect(input.kind).toBe('no_show_surge');
    expect(input.primaryAction).toEqual({
      label: 'Open Claire',
      type: 'navigate',
      target:
        '/assistant?prefill=Show me my recent no-shows and what we can do about it',
    });
    expect(input.metadata).toMatchObject({
      thisWeekNoShows: 4,
      thisWeekTotal: 20,
      lastWeekNoShows: 2,
      lastWeekTotal: 20,
    });
  });

  it('skips orgs with last-week volume under the 10-appointment floor', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-low-volume',
          thisWeekTotal: 8,
          thisWeekNoShows: 2,
          lastWeekTotal: 4,
          lastWeekNoShows: 0,
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('skips orgs whose no-show rate is flat or below the 15% surge threshold', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-flat',
          thisWeekTotal: 20,
          thisWeekNoShows: 2,
          lastWeekTotal: 20,
          lastWeekNoShows: 2, // flat
        },
        {
          organizationId: 'org-tiny-rise',
          thisWeekTotal: 20,
          thisWeekNoShows: 3,
          lastWeekTotal: 20,
          lastWeekNoShows: 3, // flat: 15% → 15%, not above threshold
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('treats any no-shows as a surge when last week had zero no-shows', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-zero-baseline',
          thisWeekTotal: 12,
          thisWeekNoShows: 1,
          lastWeekTotal: 15,
          lastWeekNoShows: 0,
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
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
          thisWeekTotal: 20,
          thisWeekNoShows: 5,
          lastWeekTotal: 20,
          lastWeekNoShows: 2,
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(generatePayloadMock).toHaveBeenCalledTimes(1);
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('isolates orgs: writes one rec per qualifying org without leaking ids', async () => {
    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-A',
          thisWeekTotal: 20,
          thisWeekNoShows: 4,
          lastWeekTotal: 20,
          lastWeekNoShows: 1,
        },
        {
          organizationId: 'org-B-low-volume',
          thisWeekTotal: 5,
          thisWeekNoShows: 3,
          lastWeekTotal: 4,
          lastWeekNoShows: 0,
        },
        {
          organizationId: 'org-C',
          thisWeekTotal: 15,
          thisWeekNoShows: 3,
          lastWeekTotal: 15,
          lastWeekNoShows: 1,
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 2, skipped: 0, failed: 0 });
    }
    const orgIdsSentToCreate = createRecMock.mock.calls.map(
      (call) => (call[1] as { organizationId: string }).organizationId
    );
    expect(orgIdsSentToCreate.sort()).toEqual(['org-A', 'org-C']);
  });

  it('skips an org when payload generation fails (no rec written)', async () => {
    generatePayloadMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'LLM down' },
    });

    const db = makeDb({
      weekRows: [
        {
          organizationId: 'org-llm-fail',
          thisWeekTotal: 20,
          thisWeekNoShows: 5,
          lastWeekTotal: 20,
          lastWeekNoShows: 2,
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

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
          thisWeekTotal: '20',
          thisWeekNoShows: '4',
          lastWeekTotal: '20',
          lastWeekNoShows: '1',
        },
      ],
    });

    const result = await runNoShowSurgeTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
    }
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.thisWeekTotal).toBe(20);
    expect(typeof input.metadata.thisWeekTotal).toBe('number');
  });
});
