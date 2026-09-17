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
  const stubFn = vi.fn(() => ({ __op: 'op' }));
  return {
    sql: sqlTag,
    and: stubFn,
    eq: stubFn,
    gt: stubFn,
    assistantRecommendation: {
      organizationId: stubColumn('assistantRecommendation.organizationId'),
      kind: stubColumn('assistantRecommendation.kind'),
      state: stubColumn('assistantRecommendation.state'),
      createdAt: stubColumn('assistantRecommendation.createdAt'),
    },
  };
}

let runOfferExpiringSoonTrigger: typeof import(
  './offer-expiring-soon.trigger.js'
).runOfferExpiringSoonTrigger;

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
}

/**
 * Drizzle's chained query builder is a thenable: `db.select().from(...).where(...).limit(N)`
 * returns something that can be `await`ed. Mirror with a Proxy that
 * intercepts `then` so awaiting resolves to a queued result row set.
 */
function makeChain(rows: unknown[]) {
  const target: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit', 'orderBy', 'groupBy']) {
    target[m] = vi.fn(() => proxy);
  }
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(rows);
      }
      return t[prop as string];
    },
  });
  return proxy;
}

function makeDb(opts: {
  orgRows?: unknown[];
  recencyQueueByOrg?: Record<string, unknown[]>;
}): MockDb {
  const recencyQueue = opts.recencyQueueByOrg ?? {};
  const callCounters: Record<string, number> = {};
  return {
    execute: vi.fn(async () => opts.orgRows ?? []),
    select: vi.fn(() => {
      // The trigger calls `db.select().from(assistantRecommendation).where(...)`
      // once per org for the 3-day dedupe lookup. Walk the queue in insertion
      // order; tests pre-seed with one entry per org.
      const allOrgs = Object.keys(recencyQueue);
      const idx = (callCounters._select ?? 0) % allOrgs.length;
      callCounters._select = (callCounters._select ?? 0) + 1;
      const orgId = allOrgs[idx] ?? '';
      return makeChain(recencyQueue[orgId] ?? []);
    }),
  };
}

const okPayload = (kind: string) => ({
  success: true as const,
  data: {
    title: 'Offers expiring this week',
    body: `You have offers ending soon (${kind}). Decide before the deadline.`,
  },
});

describe('runOfferExpiringSoonTrigger', () => {
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

    ({ runOfferExpiringSoonTrigger } = await import(
      './offer-expiring-soon.trigger.js'
    ));

    findActiveMock.mockResolvedValue({ success: true, data: null });
    createRecMock.mockResolvedValue({
      success: true,
      data: { id: 'rec-offer-1' },
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

  it('rolls up multiple expiring offers into a single rec per org', async () => {
    const db = makeDb({
      orgRows: [
        {
          organizationId: 'org-A',
          expiringCount: 3,
          soonestValidUntil: new Date('2026-04-30T00:00:00Z'),
        },
      ],
      recencyQueueByOrg: { 'org-A': [] },
    });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 1, skipped: 0, failed: 0 });
    }
    expect(createRecMock).toHaveBeenCalledTimes(1);
    const [, input] = createRecMock.mock.calls[0];
    expect(input.kind).toBe('offer_expiring_soon');
    expect(input.organizationId).toBe('org-A');
    expect(input.primaryAction).toEqual({
      label: 'Open Claire',
      type: 'navigate',
      target:
        '/assistant?prefill=Help me decide whether to extend my offers expiring this week',
    });
    expect(input.metadata).toMatchObject({
      expiringCount: 3,
      horizonDays: 7,
    });
  });

  it('suppresses re-trigger when a rec was created within the last 3 days (regardless of state)', async () => {
    const db = makeDb({
      orgRows: [
        {
          organizationId: 'org-recent-dismiss',
          expiringCount: 1,
          soonestValidUntil: new Date('2026-04-28T00:00:00Z'),
        },
      ],
      recencyQueueByOrg: {
        // The dedupe lookup returns at least one row → suppress.
        'org-recent-dismiss': [
          {
            id: 'old-rec',
            state: 'dismissed',
            createdAt: new Date('2026-04-24T00:00:00Z'),
          },
        ],
      },
    });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('idempotent: skips orgs with an active rec via createIfNotActive', async () => {
    findActiveMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'active-rec', state: 'active' },
    });

    const db = makeDb({
      orgRows: [
        {
          organizationId: 'org-active',
          expiringCount: 2,
          soonestValidUntil: new Date('2026-04-29T00:00:00Z'),
        },
      ],
      recencyQueueByOrg: { 'org-active': [] },
    });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 1, failed: 0 });
    }
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('isolates orgs: only the qualifying ones get recs', async () => {
    const db = makeDb({
      orgRows: [
        {
          organizationId: 'org-A',
          expiringCount: 1,
          soonestValidUntil: new Date('2026-04-29T00:00:00Z'),
        },
        {
          organizationId: 'org-B-recent',
          expiringCount: 4,
          soonestValidUntil: new Date('2026-05-01T00:00:00Z'),
        },
        {
          organizationId: 'org-C',
          expiringCount: 2,
          soonestValidUntil: new Date('2026-04-30T00:00:00Z'),
        },
      ],
      recencyQueueByOrg: {
        'org-A': [],
        // org-B was alerted yesterday; suppress.
        'org-B-recent': [
          {
            id: 'recent',
            state: 'active',
            createdAt: new Date('2026-04-25T00:00:00Z'),
          },
        ],
        'org-C': [],
      },
    });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 2, skipped: 0, failed: 0 });
    }
    const orgIdsCreated = createRecMock.mock.calls.map(
      (c) => (c[1] as { organizationId: string }).organizationId
    );
    expect(orgIdsCreated.sort()).toEqual(['org-A', 'org-C']);
  });

  it('filters offers by the `state` enum column, not a nonexistent `is_active` boolean', async () => {
    // Regression: the offer table has no `is_active` column — lifecycle lives
    // in the `state` enum. The original query used `o.is_active = true`, which
    // made postgres throw `column o.is_active does not exist` on every cron run.
    const db = makeDb({ orgRows: [] });

    await runOfferExpiringSoonTrigger(db as never);

    // The mocked `sql` tag (makeDatabaseStub) records each call's raw template
    // strings in `capturedSqlCalls`. The aggregate query is the first one.
    const sqlText = capturedSqlCalls[0]?.strings.join('');
    expect(sqlText).toBeDefined();
    expect(sqlText).toContain("o.state = 'active'");
    expect(sqlText).not.toContain('is_active');
  });

  it('returns ok with zero counts when no orgs have expiring offers', async () => {
    const db = makeDb({ orgRows: [] });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
  });

  it('skips an org when the dedupe lookup throws (defensive — next run re-evaluates)', async () => {
    const db = {
      execute: vi.fn(async () => [
        {
          organizationId: 'org-broken-lookup',
          expiringCount: 1,
          soonestValidUntil: new Date('2026-04-30T00:00:00Z'),
        },
      ]),
      select: vi.fn(() => {
        throw new Error('lookup table missing');
      }),
    };

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, skipped: 0, failed: 0 });
    }
    expect(generatePayloadMock).not.toHaveBeenCalled();
    expect(createRecMock).not.toHaveBeenCalled();
  });

  it('coerces bigint expiringCount (string-typed) to a number in metadata', async () => {
    const db = makeDb({
      orgRows: [
        {
          organizationId: 'org-bigint',
          expiringCount: '5',
          soonestValidUntil: new Date('2026-05-01T00:00:00Z'),
        },
      ],
      recencyQueueByOrg: { 'org-bigint': [] },
    });

    const result = await runOfferExpiringSoonTrigger(db as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
    }
    const [, input] = createRecMock.mock.calls[0];
    expect(input.metadata.expiringCount).toBe(5);
    expect(typeof input.metadata.expiringCount).toBe('number');
  });
});
