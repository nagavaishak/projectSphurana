import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import * as database from '@borradh-workspace/database';
import * as embed from '../../knowledge/embed.js';

// Recording sql tag — captures every `sql\`...\`` invocation so tests can
// assert which raw queries fired and what values flowed into them. Mirrors
// the shape used in `packages/features/src/assistant/knowledge/query.test.ts`.
type CapturedSql = {
  strings: TemplateStringsArray;
  values: unknown[];
};
const capturedSqlCalls: CapturedSql[] = [];

import { buildOperationalSnapshot } from './build-operational-snapshot.service.js';

// Both the embedding generator and the `sql` recorder are installed via
// file-local `vi.spyOn` (restored in afterEach) so neither leaks onto the
// shared worker module graph under `isolate: false`. The canonical
// `__mocks__/database.ts` supplies the WHOLE barrel — every schema table
// (`lead`/`appointment`/`conversation`/`offer`/`socialPost`/
// `metaCampaignDailyInsights`), all drizzle operators, `isNull`, and the scope
// helpers — for free via its `export * from schema`, so no file-local factory
// mock of the database module is needed. The spy only swaps in a recording
// template tag for the duration of each test. Real column refs now
// flow into `sql\`...\`` interpolations; tests assert on the strings and the
// scalar bound values, which is exactly what the recorder still captures.
let generateEmbeddingSpy: ReturnType<typeof vi.spyOn>;
let sqlSpy: ReturnType<typeof vi.spyOn>;

/**
 * `db.select().from().where().groupBy()` chain mock — each call returns
 * `this`, terminal `await` resolves to whatever was queued. We queue per-call
 * results so a service that fires multiple parallel selects gets distinct
 * answers per chain.
 *
 * Drizzle's real query builder is a thenable: any chain step (`.where()`,
 * `.groupBy()`, `.limit()`) is awaitable AND chainable. We mirror that with
 * a Proxy that intercepts `then` instead of putting `then` on the object
 * directly — biome's `noThenProperty` rule is correct in general (thenables
 * confuse Promise.resolve), but drizzle deliberately uses the pattern and
 * our mock has to match it. The Proxy keeps the `then` invisible to
 * `Object.keys` / spread / destructuring while still being awaitable.
 */
function makeChain(result: unknown) {
  const target: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit']) {
    target[m] = vi.fn(() => proxy);
  }
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return t[prop as string];
    },
  }) as Record<string, unknown>;
  return proxy;
}

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  query: {
    lead: { findMany: ReturnType<typeof vi.fn> };
    offer: { findMany: ReturnType<typeof vi.fn> };
  };
}

function makeDb(opts: {
  selectQueue?: unknown[];
  executeQueue?: unknown[];
  topRecentLeads?: unknown[];
  activeOffers?: unknown[];
}): MockDb {
  const selectQueue = [...(opts.selectQueue ?? [])];
  const executeQueue = [...(opts.executeQueue ?? [])];

  return {
    select: vi.fn(() => {
      const next = selectQueue.shift();
      return makeChain(next ?? []);
    }),
    execute: vi.fn(async () => {
      return executeQueue.shift() ?? [];
    }),
    query: {
      lead: {
        findMany: vi.fn(async () => opts.topRecentLeads ?? []),
      },
      offer: {
        findMany: vi.fn(async () => opts.activeOffers ?? []),
      },
    },
  };
}

const NOW = new Date('2026-04-25T12:34:56Z');

describe('buildOperationalSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSqlCalls.length = 0;
    generateEmbeddingSpy = vi
      .spyOn(embed, 'generateEmbedding')
      .mockResolvedValue(new Array(1536).fill(0.1));
    sqlSpy = vi.spyOn(database, 'sql').mockImplementation(((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      // Drizzle's `sql\`...\`.as(name)` chains an alias onto the fragment; the
      // chain mocks ignore the alias, we just need `.as` to exist at JS time.
      const captured: CapturedSql & { as: (name: string) => unknown } = {
        strings,
        values,
        as: (_name: string) => captured,
      };
      capturedSqlCalls.push(captured);
      return captured;
    }) as never);
  });

  afterEach(() => {
    generateEmbeddingSpy.mockRestore();
    sqlSpy.mockRestore();
  });

  it('writes a knowledge entry with templated prose for an active org', async () => {
    // Order of selects fired by the service:
    //   1. lead this-week grouped (status, source, count)
    //   2. lead prior-week count (single row)
    //   3. appointments grouped by day + status
    //   4. ad insights aggregate (one row)
    //   5. social_post published count (one row)
    const db = makeDb({
      selectQueue: [
        // 1. lead this-week
        [
          { status: 'new', source: 'facebook', count: 5 },
          { status: 'contacted', source: 'instagram', count: 3 },
        ],
        // 2. lead prior-week
        [{ count: 4 }],
        // 3. appointments today + tomorrow
        [
          { day: '2026-04-25', status: 'booked', count: 4 },
          { day: '2026-04-25', status: 'cancelled', count: 1 },
          { day: '2026-04-26', status: 'booked', count: 6 },
        ],
        // 4. ad insights aggregate
        [{ spend_usd_cents: 12_345, leads: 7, impressions: 120_000 }],
        // 5. social_post count
        [{ count: 2 }],
      ],
      executeQueue: [
        // chat feed (single execute query)
        [
          {
            total_this_week: 12,
            open_now: 3,
            escalated_now: 1,
            oldest_pending_hours: 6.4,
          },
        ],
        // delete same-day snapshots
        [],
        // insert returning id
        [{ id: 'ke-snapshot-1' }],
      ],
      topRecentLeads: [
        {
          firstName: 'Alice',
          lastName: 'Murphy',
          status: 'new',
          source: 'facebook',
        },
        {
          firstName: 'Bob',
          lastName: null,
          status: 'contacted',
          source: 'instagram',
        },
      ],
      activeOffers: [
        {
          name: 'Spring lift package',
          validUntil: new Date('2026-05-02T00:00:00Z'),
        },
        {
          name: 'Hydration intro',
          validUntil: new Date('2026-04-30T00:00:00Z'),
        },
      ],
    });

    const result = await buildOperationalSnapshot(db as never, {
      organizationId: 'org-1',
      now: NOW,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBe('ke-snapshot-1');
    }
    expect(generateEmbeddingSpy).toHaveBeenCalledTimes(1);

    // Two execute calls fire AFTER the embedding: DELETE same-day, then
    // INSERT. Plus the chat feed read at the start. Total: 3.
    expect(db.execute).toHaveBeenCalledTimes(3);

    // The INSERT is the last captured sql template.
    const insertCall = capturedSqlCalls[capturedSqlCalls.length - 1];
    const insertText = insertCall.strings.join(' ');
    expect(insertText).toContain('INSERT INTO knowledge_entry');
    expect(insertText).toContain("'operational_snapshot'");

    // Verify both org id + the cast vector + expires_at are in the bound values.
    const insertValues = insertCall.values.map((v) =>
      typeof v === 'string' ? v : v
    );
    expect(insertValues).toContain('org-1');
    // The prose is bound at index = title slot's neighbour; just check the
    // org appears and an embedding string was provided.
    const embeddingValue = insertCall.values.find(
      (v) => typeof v === 'string' && v.startsWith('[') && v.endsWith(']')
    );
    expect(embeddingValue).toBeTruthy();
  });

  it('templated prose covers every section with concrete numbers', async () => {
    const db = makeDb({
      selectQueue: [
        [{ status: 'new', source: 'facebook', count: 10 }],
        [{ count: 5 }],
        [{ day: '2026-04-25', status: 'booked', count: 3 }],
        // drizzle returns rows keyed by the JS property name on the select
        // shape (spendUsdCents), not the aliased SQL column. Mirror that.
        [{ spendUsdCents: 5_000, leads: 2, impressions: 8_000 }],
        [{ count: 1 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 4,
            open_now: 2,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
        [],
        [{ id: 'ke-2' }],
      ],
      topRecentLeads: [
        {
          firstName: 'Cara',
          lastName: 'Doyle',
          status: 'new',
          source: 'facebook',
        },
      ],
      activeOffers: [
        { name: '20% off', validUntil: new Date('2026-04-26T00:00:00Z') },
      ],
    });

    await buildOperationalSnapshot(db as never, {
      organizationId: 'org-2',
      now: NOW,
    });

    const insertCall = capturedSqlCalls[capturedSqlCalls.length - 1];
    // The prose lands as the 5th bound value (id, organizationId, NULL, type
    // are template literals; title + content are the first two `${...}`).
    const proseValue = insertCall.values.find(
      (v) =>
        typeof v === 'string' &&
        v.startsWith('Operational snapshot — daily rollup')
    ) as string | undefined;
    expect(proseValue).toBeTruthy();
    if (!proseValue) return;

    // Every section is present.
    expect(proseValue).toMatch(/Leads \(last 7 days\)/);
    expect(proseValue).toMatch(/Ads & content \(last 7 days\)/);
    expect(proseValue).toMatch(/Appointments/);
    expect(proseValue).toMatch(/Customer chats/);
    expect(proseValue).toMatch(/Offers/);

    // Concrete numbers from the feeds.
    expect(proseValue).toContain('10 new (+100% vs prior week, was 5)');
    expect(proseValue).toContain('$50.00 spend');
    expect(proseValue).toContain('3 scheduled today');
    expect(proseValue).toContain('2 open');
    expect(proseValue).toContain('1 active');
    expect(proseValue).toContain('20% off');
    // Top recent name appears.
    expect(proseValue).toContain('Cara Doyle');
  });

  it('empty-state org renders "nothing to report" prose and still writes a row', async () => {
    const db = makeDb({
      selectQueue: [
        [], // no leads this week
        [{ count: 0 }], // no leads prior week
        [], // no appointments
        [{ spend_usd_cents: 0, leads: 0, impressions: 0 }],
        [{ count: 0 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 0,
            open_now: 0,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
        [],
        [{ id: 'ke-empty' }],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    const result = await buildOperationalSnapshot(db as never, {
      organizationId: 'empty-org',
      now: NOW,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBe('ke-empty');
    }
    const insertCall = capturedSqlCalls[capturedSqlCalls.length - 1];
    const proseValue = insertCall.values.find(
      (v) =>
        typeof v === 'string' &&
        v.startsWith('Operational snapshot — daily rollup')
    ) as string | undefined;
    expect(proseValue).toContain('Leads (last 7 days): none.');
    expect(proseValue).toContain('Ads & content (last 7 days): no spend');
    expect(proseValue).toContain('Customer chats: no open threads.');
    expect(proseValue).toContain('Offers: none active.');
  });

  it('embedding failure short-circuits to skip without writing a row', async () => {
    generateEmbeddingSpy.mockRejectedValueOnce(new Error('OpenAI 429'));
    const db = makeDb({
      selectQueue: [
        [{ status: 'new', source: 'facebook', count: 1 }],
        [{ count: 0 }],
        [],
        [{ spend_usd_cents: 0, leads: 0, impressions: 0 }],
        [{ count: 0 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 0,
            open_now: 0,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    const result = await buildOperationalSnapshot(db as never, {
      organizationId: 'org-3',
      now: NOW,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBeNull();
      expect(result.data.skipReason).toBe('embedding_failed');
    }
    // Only the chat-feed execute fired — DELETE + INSERT did not.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('deletes prior same-day snapshots before inserting (idempotent rerun)', async () => {
    const db = makeDb({
      selectQueue: [
        [],
        [{ count: 0 }],
        [],
        [{ spend_usd_cents: 0, leads: 0, impressions: 0 }],
        [{ count: 0 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 0,
            open_now: 0,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
        [], // delete result
        [{ id: 'ke-rerun' }],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    await buildOperationalSnapshot(db as never, {
      organizationId: 'org-4',
      now: NOW,
    });

    // The second execute is the DELETE (after the chat-feed read).
    const deleteCall = capturedSqlCalls.find((c) =>
      c.strings.join(' ').includes('DELETE FROM knowledge_entry')
    );
    expect(deleteCall).toBeTruthy();
    if (!deleteCall) return;

    const deleteText = deleteCall.strings.join(' ');
    expect(deleteText).toContain('user_id IS NULL');
    expect(deleteText).toContain("'operational_snapshot'");
    // Org id + today's start + today's end appear in bound values.
    expect(deleteCall.values).toContain('org-4');
  });

  it('cross-org isolation: organizationId is bound on every query', async () => {
    const db = makeDb({
      selectQueue: [
        [],
        [{ count: 0 }],
        [],
        [{ spend_usd_cents: 0, leads: 0, impressions: 0 }],
        [{ count: 0 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 0,
            open_now: 0,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
        [],
        [{ id: 'ke-x' }],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    await buildOperationalSnapshot(db as never, {
      organizationId: 'tenant-A',
      now: NOW,
    });

    // The chat-feed execute, the DELETE, and the INSERT are all sql`...`
    // templates. Every one should bind `tenant-A`.
    const orgBindingCount = capturedSqlCalls.filter((c) =>
      c.values.includes('tenant-A')
    ).length;
    // chat feed binds orgId once + (now); DELETE binds orgId once; INSERT
    // binds orgId once. We assert ≥3 to keep the test resilient if the
    // service later splits a query.
    expect(orgBindingCount).toBeGreaterThanOrEqual(3);

    // No other org id leaked in.
    const allValues = capturedSqlCalls.flatMap((c) => c.values);
    expect(allValues).not.toContain('tenant-B');
  });

  it('never binds a raw Date into a sql template (postgres-js ERR_INVALID_ARG_TYPE guard)', async () => {
    // Regression for ENG-479 / Sentry API-BC: passing a `Date` straight into
    // `db.execute(sql\`…${date}…\`)` makes postgres-js call
    // `Buffer.byteLength(date)` and throw
    // `The "string" argument must be of type string ... Received an instance
    // of Date`. Every timestamp param must be pre-formatted as an ISO string.
    const db = makeDb({
      selectQueue: [
        [{ status: 'new', source: 'facebook', count: 2 }],
        [{ count: 1 }],
        [{ day: '2026-04-25', status: 'booked', count: 1 }],
        [{ spend_usd_cents: 100, leads: 1, impressions: 500 }],
        [{ count: 1 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 3,
            open_now: 1,
            escalated_now: 0,
            oldest_pending_hours: 2.1,
          },
        ],
        [],
        [{ id: 'ke-date-guard' }],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    const result = await buildOperationalSnapshot(db as never, {
      organizationId: 'org-date-guard',
      now: NOW,
    });

    expect(result.success).toBe(true);

    // The chat-feed read, DELETE and INSERT all bind timestamp params. None
    // of them may be a raw Date — that is precisely what crashed in prod.
    const allBoundValues = capturedSqlCalls.flatMap((c) => c.values);
    const dateValues = allBoundValues.filter((v) => v instanceof Date);
    expect(dateValues).toEqual([]);

    // And the timestamp params that ARE bound are ISO strings.
    const isoBound = allBoundValues.filter(
      (v) =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)
    );
    expect(isoBound.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects invalid input via Zod (empty organizationId)', async () => {
    const db = makeDb({});
    const result = await buildOperationalSnapshot(db as never, {
      organizationId: '',
      now: NOW,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
    expect(db.execute).not.toHaveBeenCalled();
    expect(generateEmbeddingSpy).not.toHaveBeenCalled();
  });

  it('formats delta percent correctly when prior-week is zero', async () => {
    // priorWeek 0 + thisWeek 5 → 100%; priorWeek 0 + thisWeek 0 → 0% → "flat"
    const db = makeDb({
      selectQueue: [
        [{ status: 'new', source: 'facebook', count: 5 }],
        [{ count: 0 }],
        [],
        [{ spend_usd_cents: 0, leads: 0, impressions: 0 }],
        [{ count: 0 }],
      ],
      executeQueue: [
        [
          {
            total_this_week: 0,
            open_now: 0,
            escalated_now: 0,
            oldest_pending_hours: null,
          },
        ],
        [],
        [{ id: 'ke-delta' }],
      ],
      topRecentLeads: [],
      activeOffers: [],
    });

    await buildOperationalSnapshot(db as never, {
      organizationId: 'org-delta',
      now: NOW,
    });

    const insertCall = capturedSqlCalls[capturedSqlCalls.length - 1];
    // The INSERT binds both title ("Operational snapshot — YYYY-MM-DD") and
    // content (the prose). Match the prose's distinctive prefix.
    const proseValue = insertCall.values.find(
      (v) =>
        typeof v === 'string' &&
        v.startsWith('Operational snapshot — daily rollup')
    ) as string | undefined;
    expect(proseValue).toContain('+100% vs prior week');
  });
});
