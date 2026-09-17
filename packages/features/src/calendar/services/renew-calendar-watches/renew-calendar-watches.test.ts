import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as startCalendarWatchModule from '../start-calendar-watch/start-calendar-watch.service.js';
import * as stopCalendarWatchModule from '../stop-calendar-watch/stop-calendar-watch.service.js';
import { renewCalendarWatches } from './renew-calendar-watches.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module (both siblings have
// their own test file). Run-time spies are load-order independent and restore.
const mocks = {} as {
  startCalendarWatch: MockInstance;
  stopCalendarWatch: MockInstance;
};

const mockDb = createMockDatabase();

describe('renewCalendarWatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Matches the old bare `vi.fn()`s: no default return; each test drives them.
    mocks.startCalendarWatch = vi
      .spyOn(startCalendarWatchModule, 'startCalendarWatch')
      .mockReturnValue(undefined as never);
    mocks.stopCalendarWatch = vi
      .spyOn(stopCalendarWatchModule, 'stopCalendarWatch')
      .mockReturnValue(undefined as never);
  });

  afterEach(() => {
    mocks.startCalendarWatch.mockRestore();
    mocks.stopCalendarWatch.mockRestore();
  });

  it('should renew expiring watches', async () => {
    const expiringAccounts = [
      {
        id: 'cal-1',
        organizationId: 'org-1',
        watchExpiration: new Date(Date.now() + 1000),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(expiringAccounts),
      }),
    });

    mocks.stopCalendarWatch.mockResolvedValueOnce({
      success: true,
      data: { stopped: true },
    });
    mocks.startCalendarWatch.mockResolvedValueOnce({
      success: true,
      data: {
        watchChannelId: 'new-channel',
        watchResourceId: 'new-resource',
        watchExpiration: new Date(),
      },
    });

    const result = await renewCalendarWatches(mockDb as never, {
      expiringWithinHours: 24,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renewed).toBe(1);
      expect(result.data.failed).toBe(0);
      expect(result.data.total).toBe(1);
    }
    expect(mocks.stopCalendarWatch).toHaveBeenCalled();
    expect(mocks.startCalendarWatch).toHaveBeenCalled();
  });

  it('should handle no expiring watches', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await renewCalendarWatches(mockDb as never, {
      expiringWithinHours: 24,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renewed).toBe(0);
      expect(result.data.failed).toBe(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should count failed renewals', async () => {
    const expiringAccounts = [
      { id: 'cal-1', organizationId: 'org-1', watchExpiration: new Date() },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(expiringAccounts),
      }),
    });

    mocks.stopCalendarWatch.mockResolvedValueOnce({
      success: true,
      data: { stopped: true },
    });
    mocks.startCalendarWatch.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed' },
    });

    const result = await renewCalendarWatches(mockDb as never, {
      expiringWithinHours: 24,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.renewed).toBe(0);
      expect(result.data.failed).toBe(1);
    }
  });

  it('should count as failed when stop throws', async () => {
    const expiringAccounts = [
      { id: 'cal-1', organizationId: 'org-1', watchExpiration: new Date() },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(expiringAccounts),
      }),
    });

    mocks.stopCalendarWatch.mockRejectedValueOnce(
      new Error('Unexpected error')
    );

    const result = await renewCalendarWatches(mockDb as never, {
      expiringWithinHours: 24,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.failed).toBe(1);
    }
  });
});
