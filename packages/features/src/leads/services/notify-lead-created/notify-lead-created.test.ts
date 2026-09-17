import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { notifyLeadCreated } from './notify-lead-created.service.js';

// Channels off so the fan-out only persists in-app rows — no real push/email.
const off = { email: false, push: false };

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    member: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
  },
};

const baseInput = {
  organizationId: 'org-1',
  leadId: 'lead-1',
  firstName: 'Jane',
  lastName: 'Doe',
  source: 'meta_lead_form' as const,
};

/** The notification row values passed to the insert, for content assertions. */
const insertedRow = () => mockDb.values.mock.calls[0]?.[0];

describe('notifyLeadCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([{ id: 'notif-1' }]);
    mockDb.query.member.findMany.mockResolvedValue([
      { userId: 'u1', user: { email: 'u1@e.com', name: 'U1' } },
    ]);
    mockDb.query.notificationPreference.findMany.mockResolvedValue([
      {
        userId: 'u1',
        preferences: {
          appointments: { scope: 'mine', channels: off },
          inbox: { scope: 'mine', channels: off },
          advertising: { enabled: true, channels: off },
          leads: { scope: 'all', channels: off },
        },
      },
    ]);
  });

  it('notifies the org when a lead arrives', async () => {
    const result = await notifyLeadCreated(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipientCount).toBe(1);
  });

  it('names the lead and its source in the body, and deep-links to the lead', () => {
    return notifyLeadCreated(mockDb as never, baseInput).then(() => {
      const row = insertedRow();
      expect(row.type).toBe('lead_created');
      expect(row.body).toBe('Jane Doe came in from Meta Lead Form.');
      expect(row.linkPath).toBe('/dashboard/clients/lead-1');
    });
  });

  it('includes the enquired-about service when known', async () => {
    await notifyLeadCreated(mockDb as never, {
      ...baseInput,
      serviceName: 'Balayage',
    });

    expect(insertedRow().body).toBe(
      'Jane Doe came in from Meta Lead Form — enquired about Balayage.'
    );
  });

  it('handles a lead with no last name', async () => {
    await notifyLeadCreated(mockDb as never, {
      ...baseInput,
      lastName: null,
      source: 'whatsapp',
    });

    expect(insertedRow().body).toBe('Jane came in from WhatsApp.');
  });

  it('carries conversationId so a simultaneous handoff can dedup against it', async () => {
    await notifyLeadCreated(mockDb as never, {
      ...baseInput,
      source: 'facebook',
      conversationId: 'conv-9',
    });

    expect(insertedRow().data).toMatchObject({
      leadId: 'lead-1',
      conversationId: 'conv-9',
    });
  });

  it('omits conversationId for leads that did not come from a conversation', async () => {
    await notifyLeadCreated(mockDb as never, baseInput);

    expect(insertedRow().data).not.toHaveProperty('conversationId');
  });

  it('does not notify when every member has the leads category off', async () => {
    mockDb.query.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'u1',
        preferences: {
          appointments: { scope: 'mine', channels: off },
          inbox: { scope: 'mine', channels: off },
          advertising: { enabled: true, channels: off },
          leads: { scope: 'off', channels: off },
        },
      },
    ]);

    const result = await notifyLeadCreated(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipientCount).toBe(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('notifies members whose preferences predate the leads category', async () => {
    // Stored JSON written before `leads` existed — defaults must fill in and
    // the member must still be notified (no migration required).
    mockDb.query.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'u1',
        preferences: {
          appointments: { scope: 'mine', channels: off },
          inbox: { scope: 'mine', channels: off },
          advertising: { enabled: true, channels: off },
        },
      },
    ]);

    const result = await notifyLeadCreated(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipientCount).toBe(1);
  });

  it('returns VALIDATION_ERROR when the lead id is missing', async () => {
    const result = await notifyLeadCreated(mockDb as never, {
      ...baseInput,
      leadId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
