import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import {
  buildPhoneCandidates,
  findExistingLead,
} from './find-existing-lead.js';

describe('buildPhoneCandidates', () => {
  it('produces the raw, digits-only, and +digits variants', () => {
    expect(buildPhoneCandidates(['353871234567'])).toEqual([
      '353871234567',
      '+353871234567',
    ]);
  });

  it('normalises a formatted number with a leading + and spaces', () => {
    expect(buildPhoneCandidates(['+353 87 123 4567'])).toEqual(
      expect.arrayContaining([
        '+353 87 123 4567',
        '353871234567',
        '+353871234567',
      ])
    );
  });

  it('dedupes across inputs and skips empty/null values', () => {
    expect(
      buildPhoneCandidates(['353871234567', '+353871234567', null, '', '  '])
    ).toEqual(['353871234567', '+353871234567']);
  });

  it('returns an empty array when nothing usable is provided', () => {
    expect(buildPhoneCandidates([null, undefined, ''])).toEqual([]);
  });
});

describe('findExistingLead', () => {
  const mockDb = {
    query: { lead: { findFirst: vi.fn() } },
  };

  beforeEach(() => vi.clearAllMocks());

  it('queries and returns the matched lead for WhatsApp (by phone)', async () => {
    const row = { id: 'lead-wa', source: 'meta_lead_form' };
    mockDb.query.lead.findFirst.mockResolvedValueOnce(row);

    const result = await findExistingLead(mockDb as never, {
      organizationId: 'org-1',
      platform: 'whatsapp',
      senderId: '353871234567',
    });

    expect(mockDb.query.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toBe(row);
  });

  it('queries for Messenger using the PSID', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await findExistingLead(mockDb as never, {
      organizationId: 'org-1',
      platform: 'facebook_messenger',
      senderId: 'psid-123',
    });

    expect(mockDb.query.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('queries when a Messenger conversation later supplies phone/email', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({ id: 'lead-late' });

    const result = await findExistingLead(mockDb as never, {
      organizationId: 'org-1',
      platform: 'facebook_messenger',
      senderId: 'psid-123',
      email: 'someone@example.com',
    });

    expect(mockDb.query.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'lead-late' });
  });

  it('short-circuits to null without querying when there is no identifier', async () => {
    const result = await findExistingLead(mockDb as never, {
      organizationId: 'org-1',
      platform: 'whatsapp',
      senderId: '', // no phone, no email
    });

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
