import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { summariseRecentLeads } from './summarise-recent-leads.service.js';

describe('summariseRecentLeads', () => {
  // Drizzle's typed `db.select(...).from(...).where(...).groupBy(...)` chain
  // resolves at the last call. The service issues two distinct selects (one
  // grouped current window, one scalar previous count) plus a relational
  // `db.query.lead.findMany`. Each chain returns its own mock spine so we can
  // resolve them independently.
  let currentSelectChain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  let previousSelectChain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };
  let select: ReturnType<typeof vi.fn>;
  let leadFindMany: ReturnType<typeof vi.fn>;
  let orgFindFirst: ReturnType<typeof vi.fn>;
  let mockDb: {
    select: typeof select;
    query: {
      lead: { findMany: typeof leadFindMany };
      organization: { findFirst: typeof orgFindFirst };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    currentSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn(),
    };
    previousSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
    };

    // First `db.select(...)` call (current window grouped query) returns the
    // current chain; second call (previous-window scalar count) returns the
    // previous chain.
    select = vi
      .fn()
      .mockReturnValueOnce(currentSelectChain)
      .mockReturnValueOnce(previousSelectChain);
    leadFindMany = vi.fn();
    orgFindFirst = vi.fn();

    mockDb = {
      select,
      query: {
        lead: { findMany: leadFindMany },
        organization: { findFirst: orgFindFirst },
      },
    };
  });

  const validInput = {
    organizationId: 'org_123',
    timeframe: 'week' as const,
  };

  it('returns counts, breakdowns, deltaPercent and topLeads in shape', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([
      { status: 'new', source: 'facebook', count: 6 },
      { status: 'contacted', source: 'facebook', count: 2 },
      { status: 'new', source: 'website', count: 2 },
    ]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 5 }]);
    leadFindMany.mockResolvedValueOnce([
      {
        id: 'lead_1',
        firstName: 'Aoife',
        lastName: 'Murphy',
        email: 'aoife@example.com',
        phone: null,
        status: 'new',
        source: 'facebook',
        createdAt: new Date('2026-04-22T10:00:00Z'),
      },
      {
        id: 'lead_2',
        firstName: 'Cian',
        lastName: 'Walsh',
        email: null,
        phone: '+353871234567',
        status: 'contacted',
        source: 'facebook',
        createdAt: new Date('2026-04-21T10:00:00Z'),
      },
    ]);

    const result = await summariseRecentLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timeframe).toBe('week');
    expect(result.data.totalLeads).toBe(10);
    expect(result.data.previousLeads).toBe(5);
    // (10 - 5) / 5 * 100 = 100
    expect(result.data.deltaPercent).toBe(100);
    expect(result.data.byStatus).toEqual({ new: 8, contacted: 2 });
    expect(result.data.bySource).toEqual({ facebook: 8, website: 2 });
    expect(result.data.topLeads).toHaveLength(2);
    expect(result.data.topLeads[0].firstName).toBe('Aoife');
  });

  it('handles zero leads in both windows without dividing by zero', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
    leadFindMany.mockResolvedValueOnce([]);

    const result = await summariseRecentLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalLeads).toBe(0);
    expect(result.data.previousLeads).toBe(0);
    expect(result.data.deltaPercent).toBe(0);
    expect(result.data.topLeads).toHaveLength(0);
  });

  it('reports +100% when coming from zero previous leads', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([
      { status: 'new', source: 'manual', count: 4 },
    ]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
    leadFindMany.mockResolvedValueOnce([]);

    const result = await summariseRecentLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalLeads).toBe(4);
    expect(result.data.previousLeads).toBe(0);
    expect(result.data.deltaPercent).toBe(100);
  });

  it('returns negative deltaPercent when current window is smaller', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([
      { status: 'new', source: 'manual', count: 2 },
    ]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 10 }]);
    leadFindMany.mockResolvedValueOnce([]);

    const result = await summariseRecentLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // (2 - 10) / 10 * 100 = -80
    expect(result.data.deltaPercent).toBe(-80);
  });

  it('respects custom limit on topLeads slice', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([
      { status: 'new', source: 'manual', count: 1 },
    ]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 1 }]);
    leadFindMany.mockResolvedValueOnce([]);

    await summariseRecentLeads(mockDb as never, {
      ...validInput,
      limit: 3,
    });

    expect(leadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 })
    );
  });

  it('defaults timeframe to "week" when omitted', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
    leadFindMany.mockResolvedValueOnce([]);

    const result = await summariseRecentLeads(
      mockDb as never,
      {
        organizationId: 'org_123',
      } as never
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timeframe).toBe('week');
  });

  it('anchors the "today" window to midnight in the ORG\'s zone, not UTC', async () => {
    // 2026-08-12T03:00Z is still 2026-08-11 20:00 in Los Angeles. The UTC day
    // has rolled over; the org's day has not.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T03:00:00Z'));

    try {
      currentSelectChain.groupBy.mockResolvedValueOnce([]);
      previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      leadFindMany.mockResolvedValueOnce([]);
      orgFindFirst.mockResolvedValueOnce({ timezone: 'America/Los_Angeles' });

      const result = await summariseRecentLeads(mockDb as never, {
        organizationId: 'org_123',
        timeframe: 'today' as const,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      // Midnight on 2026-08-11 in LA (PDT, UTC-7) = 2026-08-11T07:00:00Z.
      // The UTC-day answer would have been 2026-08-12T00:00:00Z.
      expect(result.data.windowStart).toBe('2026-08-11T07:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to UTC for "today" when the org has no timezone row', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T03:00:00Z'));

    try {
      currentSelectChain.groupBy.mockResolvedValueOnce([]);
      previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      leadFindMany.mockResolvedValueOnce([]);
      orgFindFirst.mockResolvedValueOnce(undefined);

      const result = await summariseRecentLeads(mockDb as never, {
        organizationId: 'org_123',
        timeframe: 'today' as const,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.windowStart).toBe('2026-08-12T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not look up the org timezone for rolling timeframes', async () => {
    currentSelectChain.groupBy.mockResolvedValueOnce([]);
    previousSelectChain.where.mockResolvedValueOnce([{ count: 0 }]);
    leadFindMany.mockResolvedValueOnce([]);

    await summariseRecentLeads(mockDb as never, validInput);

    expect(orgFindFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      summariseRecentLeads(mockDb as never, {
        organizationId: '',
        timeframe: 'week',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(select).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid timeframe', async () => {
    await expectResult(
      summariseRecentLeads(mockDb as never, {
        organizationId: 'org_123',
        timeframe: 'year' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for limit above 20', async () => {
    await expectResult(
      summariseRecentLeads(mockDb as never, {
        organizationId: 'org_123',
        timeframe: 'week',
        limit: 50,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('propagates database errors', async () => {
    currentSelectChain.groupBy.mockRejectedValueOnce(new Error('db down'));

    await expect(
      summariseRecentLeads(mockDb as never, validInput)
    ).rejects.toThrow('db down');
  });
});
