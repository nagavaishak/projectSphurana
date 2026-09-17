import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { dispatchNotification } from './dispatch-notification.service.js';

// Channels off so createNotification only persists the in-app row — no real
// push/email side effects during the test.
const off = { email: false, push: false };
const prefs = (over: Record<string, unknown> = {}) => ({
  appointments: { scope: 'mine', channels: off },
  inbox: { scope: 'mine', channels: off },
  advertising: { enabled: true, channels: off },
  ...over,
});

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    member: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
  },
};

describe('dispatchNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([{ id: 'notif-1' }]);
  });

  it('notifies only the assignee when scope is "mine"', async () => {
    mockDb.query.member.findMany.mockResolvedValueOnce([
      { userId: 'u1', user: { email: 'u1@e.com', name: 'U1' } },
      { userId: 'u2', user: { email: 'u2@e.com', name: 'U2' } },
    ]);
    mockDb.query.notificationPreference.findMany.mockResolvedValueOnce([]);

    const result = await dispatchNotification(mockDb as never, {
      organizationId: 'org-1',
      type: 'appointment_booked',
      title: 'New booking',
      body: 'A booking was made',
      assigneeUserId: 'u1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipientCount).toBe(1);
  });

  it('notifies every member when scope is "all"', async () => {
    mockDb.query.member.findMany.mockResolvedValueOnce([
      { userId: 'u1', user: { email: 'u1@e.com', name: 'U1' } },
      { userId: 'u2', user: { email: 'u2@e.com', name: 'U2' } },
    ]);
    mockDb.query.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'u1',
        preferences: prefs({ appointments: { scope: 'all', channels: off } }),
      },
      {
        userId: 'u2',
        preferences: prefs({ appointments: { scope: 'all', channels: off } }),
      },
    ]);

    const result = await dispatchNotification(mockDb as never, {
      organizationId: 'org-1',
      type: 'appointment_cancelled',
      title: 'Cancelled',
      body: 'An appointment was cancelled',
      assigneeUserId: 'u1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipientCount).toBe(2);
  });

  it('returns VALIDATION_ERROR for a missing title', async () => {
    const result = await dispatchNotification(mockDb as never, {
      organizationId: 'org-1',
      type: 'ad_rejected',
      title: '',
      body: 'x',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
