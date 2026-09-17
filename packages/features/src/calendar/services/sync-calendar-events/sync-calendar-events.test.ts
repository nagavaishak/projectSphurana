import {
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { syncCalendarEvents } from './sync-calendar-events.service.js';

// Canonical integration-service mocks return a stable shared instance whose
// methods are auto-vivified vi.fn()s.
const calendarServiceInstance = new (
  GoogleCalendarService as never as new () => {
    listEventsWithSyncToken: ReturnType<typeof vi.fn>;
  }
)();
const mockListEventsWithSyncToken = vi.mocked(
  calendarServiceInstance.listEventsWithSyncToken
);
const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

const mockDb = createMockDatabase();

const mockCalAccount = {
  id: 'cal-1',
  organizationId: 'org-1',
  isActive: true,
  calendarId: 'primary',
  syncToken: 'old-sync-token',
  encryptedCredentials: 'encrypted',
  tokenExpiresAt: new Date(Date.now() + 3600000),
};

describe('syncCalendarEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDecryptCredentials.mockReturnValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 3600,
    });
    mockEncryptCredentials.mockReturnValue('encrypted');
  });

  it('should sync events with no changes', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockListEventsWithSyncToken.mockResolvedValueOnce({
      events: [],
      nextSyncToken: 'new-sync-token',
      fullSyncRequired: false,
    });
    mockDb.returning.mockResolvedValueOnce([{}]);

    const result = await syncCalendarEvents(mockDb as never, {
      calendarAccountId: 'cal-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(0);
      expect(result.data.cancelled).toBe(0);
    }
  });

  it('should update existing appointment when event changed', async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 3600000);
    const changedEvent = {
      id: 'google-event-1',
      status: 'confirmed',
      summary: 'Updated Title',
      start: { dateTime: now.toISOString() },
      end: { dateTime: later.toISOString() },
      description: null,
    };

    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockListEventsWithSyncToken.mockResolvedValueOnce({
      events: [changedEvent],
      nextSyncToken: 'new-sync-token',
      fullSyncRequired: false,
    });

    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      externalCalendarEventId: 'google-event-1',
      calendarAccountId: 'cal-1',
      title: 'Old Title',
      startDate: new Date(now.getTime() - 1000),
      endDate: new Date(later.getTime() - 1000),
      description: null,
      status: 'booked',
    });
    mockDb.returning.mockResolvedValueOnce([{}]); // appointment update
    mockDb.returning.mockResolvedValueOnce([{}]); // syncToken update

    const result = await syncCalendarEvents(mockDb as never, {
      calendarAccountId: 'cal-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
    }
  });

  it('should cancel appointment when event deleted', async () => {
    const cancelledEvent = {
      id: 'google-event-1',
      status: 'cancelled',
    };

    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockListEventsWithSyncToken.mockResolvedValueOnce({
      events: [cancelledEvent],
      nextSyncToken: 'new-sync-token',
      fullSyncRequired: false,
    });

    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      externalCalendarEventId: 'google-event-1',
      calendarAccountId: 'cal-1',
      status: 'booked',
    });
    mockDb.returning.mockResolvedValueOnce([{}]); // cancel update
    mockDb.returning.mockResolvedValueOnce([{}]); // syncToken update

    const result = await syncCalendarEvents(mockDb as never, {
      calendarAccountId: 'cal-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cancelled).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR for empty calendarAccountId', async () => {
    await expectResult(
      syncCalendarEvents(mockDb as never, { calendarAccountId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when calendar account does not exist', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncCalendarEvents(mockDb as never, { calendarAccountId: 'nonexistent' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return ok with zeros when account is inactive', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      ...mockCalAccount,
      isActive: false,
    });

    const result = await syncCalendarEvents(mockDb as never, {
      calendarAccountId: 'cal-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(0);
      expect(result.data.cancelled).toBe(0);
    }
  });

  it('should do full re-sync when syncToken expired', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockListEventsWithSyncToken
      .mockResolvedValueOnce({
        events: [],
        nextSyncToken: null,
        fullSyncRequired: true,
      })
      .mockResolvedValueOnce({
        events: [],
        nextSyncToken: 'fresh-token',
        fullSyncRequired: false,
      });
    mockDb.returning.mockResolvedValueOnce([{}]);

    const result = await syncCalendarEvents(mockDb as never, {
      calendarAccountId: 'cal-1',
    });

    expect(result.success).toBe(true);
    expect(mockListEventsWithSyncToken).toHaveBeenCalledTimes(2);
  });

  it('should return INTERNAL_ERROR when Google API fails', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockListEventsWithSyncToken.mockRejectedValueOnce(
      new Error('Google API error')
    );

    await expectResult(
      syncCalendarEvents(mockDb as never, { calendarAccountId: 'cal-1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
