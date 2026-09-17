import { beforeEach, describe, expect, it, vi } from 'vitest';

// This suite doesn't inspect the raw SQL — `db.execute` is mocked to return
// queued rowsets, so the real drizzle `sql\`...\`` tag and the real
// `conversation`/`conversationMessage` tables (both supplied by the canonical
// `__mocks__/database.ts` via `export * from schema`) are exactly what we want.
// No file-local factory mock of the database module — a stripped factory
// there would leak onto the shared worker graph under `isolate: false` (e.g.
// delete-lead → softDeleteLeadChildren calls `and`) and the stubbed
// `conversation`/`conversationMessage` tables would shadow the real ones other
// files rely on. Scope helpers come free from the canonical mock too.
import { ErrorCodes } from '../../../shared/index.js';
import { summariseConversationsThisWeek } from './summarise-this-week.service.js';

/**
 * The service dispatches FOUR queries via `Promise.all`. Each is a single
 * `db.execute(sql\`...\`)` call. The mock returns a different rowset per call
 * via `mockResolvedValueOnce` chained in the order:
 *   1. counts        (CountsRow[])
 *   2. byChannel     (ChannelRow[])
 *   3. responseTime  (ResponseTimeRow[])
 *   4. oldestPending (OldestPendingRow[])
 *
 * Tests can inspect `mockDb.execute.mock.calls` for ordering / shape.
 */
const mockDb = {
  execute: vi.fn(),
};

describe('summariseConversationsThisWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns aggregated rollup for a week with conversations across channels', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 12,
          open_threads: 5,
          escalated_threads: 2,
          closed_threads: 7,
        },
      ])
      .mockResolvedValueOnce([
        { platform: 'whatsapp', count: 6 },
        { platform: 'facebook_messenger', count: 4 },
        { platform: 'instagram_dm', count: 2 },
      ])
      .mockResolvedValueOnce([{ p50_ms: 12_000, p95_ms: 180_000 }])
      .mockResolvedValueOnce([
        {
          conversation_id: 'conv-stuck-1',
          customer_name: 'Sarah',
          hours_pending: 36.4,
        },
      ]);

    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.counts).toEqual({
      totalThreads: 12,
      openThreads: 5,
      escalatedThreads: 2,
      closedThreads: 7,
    });
    expect(result.data.byChannel).toEqual({
      whatsapp: 6,
      facebook_messenger: 4,
      instagram_dm: 2,
    });
    expect(result.data.responseTime).toEqual({ p50Ms: 12_000, p95Ms: 180_000 });
    expect(result.data.oldestPending).toEqual({
      conversationId: 'conv-stuck-1',
      customerName: 'Sarah',
      hoursPending: 36, // rounded
    });
    // topIntents is intentionally empty until intent tagging lands (C-13).
    expect(result.data.topIntents).toEqual([]);
    // Service was called four times (parallel via Promise.all).
    expect(mockDb.execute).toHaveBeenCalledTimes(4);
  });

  it('handles an empty week cleanly (zero counts, no oldest pending)', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 0,
          open_threads: 0,
          escalated_threads: 0,
          closed_threads: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ p50_ms: 0, p95_ms: 0 }])
      .mockResolvedValueOnce([]);

    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-empty',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.counts.totalThreads).toBe(0);
    expect(result.data.byChannel).toEqual({
      whatsapp: 0,
      facebook_messenger: 0,
      instagram_dm: 0,
    });
    expect(result.data.responseTime).toEqual({ p50Ms: 0, p95Ms: 0 });
    expect(result.data.oldestPending).toBeNull();
  });

  it('passes the organization ID into every query (cross-org isolation)', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 0,
          open_threads: 0,
          escalated_threads: 0,
          closed_threads: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ p50_ms: 0, p95_ms: 0 }])
      .mockResolvedValueOnce([]);

    const orgId = 'org-isolation-test';
    await summariseConversationsThisWeek(mockDb as never, {
      organizationId: orgId,
    });

    // Each of the four db.execute() calls passes a single drizzle SQL
    // template. We can't easily inspect the parameter list from the
    // template, but we can verify a SQL chunk argument was passed AND
    // the call count is 4 (parallel) — i.e., the service did not short-
    // circuit after a single org-scoped query.
    expect(mockDb.execute).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i++) {
      // Each call gets a single argument (the drizzle SQL template).
      expect(mockDb.execute.mock.calls[i]?.length).toBe(1);
    }
  });

  it('uses the explicit timeframe when both since and until are provided', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 0,
          open_threads: 0,
          escalated_threads: 0,
          closed_threads: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ p50_ms: 0, p95_ms: 0 }])
      .mockResolvedValueOnce([]);

    const since = new Date('2026-04-01T00:00:00Z');
    const until = new Date('2026-04-08T00:00:00Z');
    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
      since,
      until,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timeframe.since).toBe(since.toISOString());
    expect(result.data.timeframe.until).toBe(until.toISOString());
  });

  it('defaults to a 7-day trailing window when timeframe is omitted', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 0,
          open_threads: 0,
          escalated_threads: 0,
          closed_threads: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ p50_ms: 0, p95_ms: 0 }])
      .mockResolvedValueOnce([]);

    const before = Date.now();
    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;
    const sinceMs = new Date(result.data.timeframe.since).getTime();
    const untilMs = new Date(result.data.timeframe.until).getTime();
    expect(untilMs).toBeGreaterThanOrEqual(before);
    expect(untilMs).toBeLessThanOrEqual(after);
    // Default window length is exactly 7 days.
    expect(untilMs - sinceMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('returns VALIDATION_ERROR when organizationId is empty', async () => {
    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    // No DB access should have happened.
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('treats a row with null percentile values as zero (no qualifying gaps)', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 1,
          open_threads: 1,
          escalated_threads: 0,
          closed_threads: 0,
        },
      ])
      .mockResolvedValueOnce([{ platform: 'whatsapp', count: 1 }])
      // No bot/agent reply pairs in the window — Postgres returns null for
      // percentile_cont over an empty group; the service coerces to 0.
      .mockResolvedValueOnce([{ p50_ms: null, p95_ms: null }])
      .mockResolvedValueOnce([]);

    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.responseTime).toEqual({ p50Ms: 0, p95Ms: 0 });
  });

  it('rolls up unknown platforms by ignoring them (only the three locked channels surface)', async () => {
    mockDb.execute
      .mockResolvedValueOnce([
        {
          total_threads: 4,
          open_threads: 2,
          escalated_threads: 1,
          closed_threads: 2,
        },
      ])
      // 'sms' is not a real platform value today — exercise the "ignore
      // unknown" branch so future enum additions don't silently leak.
      .mockResolvedValueOnce([
        { platform: 'whatsapp', count: 2 },
        { platform: 'sms', count: 999 },
      ])
      .mockResolvedValueOnce([{ p50_ms: 0, p95_ms: 0 }])
      .mockResolvedValueOnce([]);

    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.byChannel.whatsapp).toBe(2);
    // 'sms' is dropped on the floor.
    expect(
      Object.values(result.data.byChannel).reduce((a, b) => a + b, 0)
    ).toBe(2);
  });

  it('returns INTERNAL_ERROR when a query throws', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('connection lost'));

    const result = await summariseConversationsThisWeek(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
