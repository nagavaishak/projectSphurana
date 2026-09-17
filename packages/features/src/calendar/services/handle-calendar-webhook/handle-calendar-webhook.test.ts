import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as syncCalendarEventsModule from '../sync-calendar-events/sync-calendar-events.service.js';
import { handleCalendarWebhook } from './handle-calendar-webhook.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module. A run-time spy is
// load-order independent and restores cleanly.
let mockSyncCalendarEvents: MockInstance;

const mockDb = createMockDatabase();

const validInput = {
  channelId: 'channel-1',
  resourceState: 'exists',
  resourceId: 'resource-1',
  // Matches GOOGLE_CALENDAR_WEBHOOK_TOKEN in the canonical env/api mock.
  channelToken: 'mock-google-calendar-webhook-token',
};

describe('handleCalendarWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSyncCalendarEvents = vi
      .spyOn(syncCalendarEventsModule, 'syncCalendarEvents')
      .mockResolvedValue({
        success: true,
        data: { updated: 0, cancelled: 0 },
      } as never);
  });

  afterEach(() => {
    mockSyncCalendarEvents.mockRestore();
  });

  it('should process webhook for existing channel', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'cal-1',
    });

    const result = await handleCalendarWebhook(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(true);
    }
  });

  it('should acknowledge sync resource state', async () => {
    const result = await handleCalendarWebhook(mockDb as never, {
      ...validInput,
      resourceState: 'sync',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(true);
    }
    expect(mockDb.query.calendarAccount.findFirst).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for invalid token', async () => {
    await expectResult(
      handleCalendarWebhook(mockDb as never, {
        ...validInput,
        channelToken: 'wrong-token',
      })
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('should return VALIDATION_ERROR for empty channelId', async () => {
    await expectResult(
      handleCalendarWebhook(mockDb as never, {
        ...validInput,
        channelId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return processed=false when channel not found', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    const result = await handleCalendarWebhook(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(false);
    }
  });

  it('should process not_exists resource state', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'cal-1',
    });

    const result = await handleCalendarWebhook(mockDb as never, {
      ...validInput,
      resourceState: 'not_exists',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(true);
    }
  });
});
