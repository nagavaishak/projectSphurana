import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import {
  buildDailySeries,
  buildMonthlySeries,
  getAssistantUsageHistory,
} from './get-usage-history.service.js';

describe('buildDailySeries', () => {
  it('fills missing days with zero counts and orders oldest → newest', () => {
    const endDate = new Date(Date.UTC(2026, 3, 26));
    const series = buildDailySeries(
      [
        { date: '2026-04-25', count: 12 },
        { date: '2026-04-26', count: 5 },
      ],
      endDate,
      5
    );
    expect(series).toEqual([
      { date: '2026-04-22', count: 0 },
      { date: '2026-04-23', count: 0 },
      { date: '2026-04-24', count: 0 },
      { date: '2026-04-25', count: 12 },
      { date: '2026-04-26', count: 5 },
    ]);
  });

  it('returns all-zero series when there is no data', () => {
    const endDate = new Date(Date.UTC(2026, 0, 3));
    const series = buildDailySeries([], endDate, 3);
    expect(series).toEqual([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 0 },
      { date: '2026-01-03', count: 0 },
    ]);
  });
});

describe('buildMonthlySeries', () => {
  it('fills missing months with zero counts and orders oldest → newest', () => {
    const endDate = new Date(Date.UTC(2026, 3, 26));
    const series = buildMonthlySeries(
      [
        { month: '2026-02', count: 30 },
        { month: '2026-04', count: 17 },
      ],
      endDate,
      4
    );
    expect(series).toEqual([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 30 },
      { month: '2026-03', count: 0 },
      { month: '2026-04', count: 17 },
    ]);
  });

  it('crosses a year boundary correctly', () => {
    const endDate = new Date(Date.UTC(2026, 1, 15));
    const series = buildMonthlySeries(
      [{ month: '2025-12', count: 9 }],
      endDate,
      3
    );
    expect(series).toEqual([
      { month: '2025-12', count: 9 },
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 0 },
    ]);
  });
});

describe('getAssistantUsageHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the daily + monthly series and an empty topTools array', async () => {
    const dailyRows = [{ date: '2026-04-26', count: 4 }];
    const monthlyRows = [{ month: '2026-04', count: 4 }];
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(dailyRows)
        .mockResolvedValueOnce(monthlyRows),
    };

    const result = await getAssistantUsageHistory(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.daily).toHaveLength(30);
      expect(result.data.daily.at(-1)?.count).toBeGreaterThanOrEqual(0);
      expect(result.data.monthly).toHaveLength(6);
      expect(result.data.topTools).toEqual([]);
    }
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it('honours custom days + monthlyMonths override', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    };

    const result = await getAssistantUsageHistory(mockDb as never, {
      organizationId: 'org-1',
      days: 7,
      monthlyMonths: 3,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.daily).toHaveLength(7);
      expect(result.data.monthly).toHaveLength(3);
    }
  });

  it('returns VALIDATION_ERROR when organizationId is empty', async () => {
    const mockDb = { execute: vi.fn() };

    const result = await getAssistantUsageHistory(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when days exceeds 90', async () => {
    const mockDb = { execute: vi.fn() };

    const result = await getAssistantUsageHistory(mockDb as never, {
      organizationId: 'org-1',
      days: 365,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the daily query fails', async () => {
    const mockDb = {
      execute: vi.fn().mockRejectedValueOnce(new Error('connection refused')),
    };

    const result = await getAssistantUsageHistory(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
