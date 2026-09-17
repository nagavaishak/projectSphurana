import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { attachLeadAttribution } from './attach-lead-attribution.service.js';

const ORG_ID = 'org_123';
const BLANK_LEAD = {
  id: 'lead_1',
  micrositeId: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
};

describe('attachLeadAttribution', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lands the UTMs from a landing URL on the lead', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(BLANK_LEAD);

    const result = await attachLeadAttribution(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_1',
      micrositeId: 'site_1',
      landingUrl:
        'https://salon.com/book?utm_source=meta&utm_medium=paid_social&utm_campaign=camp_1&utm_content=ad_9',
    });

    expect(result.success).toBe(true);
    const written = mockDb.set.mock.calls[0]?.[0] as Record<string, string>;
    expect(written).toEqual({
      micrositeId: 'site_1',
      utmSource: 'meta',
      utmMedium: 'paid_social',
      utmCampaign: 'camp_1',
      utmContent: 'ad_9',
    });
  });

  it('stores micrositeId and NEVER the host', async () => {
    // §9: the same site on two different hosts must produce the same stored
    // attribution, or a domain move splits the tenant's history in two.
    const writes: Record<string, string>[] = [];
    for (const host of ['salon.borradh.io', 'salon.com']) {
      mockDb._resetMocks();
      mockDb.query.lead.findFirst.mockResolvedValueOnce(BLANK_LEAD);
      await attachLeadAttribution(mockDb as never, {
        organizationId: ORG_ID,
        leadId: 'lead_1',
        micrositeId: 'site_1',
        landingUrl: `https://${host}/book?utm_campaign=camp_1`,
      });
      writes.push(mockDb.set.mock.calls[0]?.[0] as Record<string, string>);
    }

    expect(writes[0]).toEqual(writes[1]);
    expect(JSON.stringify(writes[0])).not.toContain('salon.com');
    expect(JSON.stringify(writes[0])).not.toContain('borradh.io');
    expect(writes[0]?.micrositeId).toBe('site_1');
  });

  it('keeps first touch — a later organic visit cannot launder the spend', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      ...BLANK_LEAD,
      micrositeId: 'site_1',
      utmSource: 'meta',
      utmCampaign: 'camp_1',
    });

    const result = await attachLeadAttribution(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_1',
      landingUrl: 'https://salon.com/book?utm_source=google&utm_medium=organic',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.utm.campaign).toBe('camp_1');
    expect(result.data.utm.source).toBe('meta');
    // Only the previously-empty field is filled in.
    expect(mockDb.set.mock.calls[0]?.[0]).toEqual({ utmMedium: 'organic' });
  });

  it('writes nothing when there is nothing new to add', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      ...BLANK_LEAD,
      utmCampaign: 'camp_1',
    });

    const result = await attachLeadAttribution(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_1',
      utmCampaign: 'camp_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.changed).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a lead in another organization', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await attachLeadAttribution(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_other',
      utmCampaign: 'camp_1',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
