import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import {
  linkOrCreateConversationLead,
  platformToLeadSource,
} from './create-conversation-lead.js';

const mockDb = {
  query: {
    lead: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'new-lead-1' }]),
};

describe('platformToLeadSource', () => {
  it('maps facebook_messenger to facebook', () => {
    expect(platformToLeadSource('facebook_messenger')).toBe('facebook');
  });

  it('maps instagram_dm to instagram', () => {
    expect(platformToLeadSource('instagram_dm')).toBe('instagram');
  });

  it('maps whatsapp to whatsapp', () => {
    expect(platformToLeadSource('whatsapp')).toBe('whatsapp');
  });
});

describe('linkOrCreateConversationLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.returning.mockResolvedValue([{ id: 'new-lead-1' }]);
  });

  it('creates a new lead for facebook_messenger keyed by psid', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const leadId = await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'sender-123',
      'John Doe',
      'facebook_messenger'
    );

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        firstName: 'John',
        lastName: 'Doe',
        source: 'facebook',
        status: 'new',
        psid: 'sender-123',
      })
    );
    expect(leadId).toBe('new-lead-1');
  });

  it('creates a new lead for whatsapp with whatsapp field', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      '+1234567890',
      'Jane Smith',
      'whatsapp'
    );

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'whatsapp',
        whatsapp: '+1234567890',
        firstName: 'Jane',
        lastName: 'Smith',
      })
    );
  });

  it('creates a new lead for instagram_dm keyed by psid', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'ig-user-1',
      'SingleName',
      'instagram_dm'
    );

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'instagram',
        firstName: 'SingleName',
        lastName: undefined,
        psid: 'ig-user-1',
      })
    );
  });

  it('uses senderId as firstName when no name provided', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'sender-123',
      undefined,
      'facebook_messenger'
    );

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'sender-123',
        lastName: undefined,
      })
    );
  });

  it('reuses an existing lead and returns its id without inserting', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'existing-lead-1',
    });

    const leadId = await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'sender-123',
      'John Doe',
      'facebook_messenger'
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(leadId).toBe('existing-lead-1');
  });

  it('does not throw on DB error and returns null (non-fatal)', async () => {
    mockDb.query.lead.findFirst.mockRejectedValueOnce(
      new Error('DB connection failed')
    );

    const leadId = await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'sender-123',
      'John Doe',
      'facebook_messenger'
    );

    expect(leadId).toBeNull();
  });

  it('parses multi-word names correctly', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await linkOrCreateConversationLead(
      mockDb as never,
      'org-1',
      'sender-123',
      'Mary Jane Watson Parker',
      'facebook_messenger'
    );

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Mary',
        lastName: 'Jane Watson Parker',
      })
    );
  });
});
